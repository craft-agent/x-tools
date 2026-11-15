import { ToolError, isAbortError, isToolError } from "../errors"
import { checkSources } from "../posts/check-sources"
import { parsePostRef } from "../posts/refs"
import { readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import { requireRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { downloadMedia, originalPhotoUrl, type DownloadOptions, type MediaKind } from "./cdn"
import { preparePostFolder, removeIfEmpty, requireDownloadDir, type PostFolder } from "./folder"
import { readMediaFromAccount, readMediaFromFxTwitter, type MediaItem } from "./post-media"
import { SAVED_MEDIA_NOTE, type MediaDownloadInput, type MediaDownloadOutput } from "./schemas"

/** What a test may change about the download: where its requests go and which hosts they may reach. Never an argument of the tool. */
export type DownloadOverrides = Pick<DownloadOptions, "connect" | "hosts">

/** One medium to save: the post it belongs to, its kind, where to fetch it (null when it has no MP4) and the stem of its file. */
type PlannedItem = { from: string; kind: MediaKind; url: string | null; stem: string }

type SavedFile = MediaDownloadOutput["files"][number]
type FailedFile = MediaDownloadOutput["failed"][number]

function noMp4Error(): ToolError {
  return new ToolError("upstream_error", "The media could not be downloaded: it has no MP4 version to fetch.", {
    details: { source: "cdn", reason: "no_mp4" },
  })
}

/** The items of the post `from`, numbered from 1 in the post's order. */
function planItems(from: string, items: readonly MediaItem[]): PlannedItem[] {
  return items.map((item, index) => ({ from, ...item, stem: `${from}-${index + 1}` }))
}

/** Why a post whose lookup found nothing is not available, as the source told it. */
function unavailableError(status: string, reason: string, source: string): ToolError {
  return new ToolError("not_found", `The post is not available: ${status} (${reason}), as read from ${source}.`, {
    details: { source, status, reason },
  })
}

function nothingToSave(quotedHasMedia: boolean): ToolError {
  const hint = quotedHasMedia ? " The post it quotes has some: pass quoted: true." : ""
  return new ToolError("not_found", `The post has no photo, video or GIF to save.${hint}`)
}

/** Reads the post's media through the sources the call chose and plans the files to save, the post's own first. */
async function planPost(
  args: MediaDownloadInput,
  id: string,
  reader: Reader,
): Promise<{ planned: PlannedItem[]; source: MediaDownloadOutput["source"] }> {
  await checkSources(args, reader)
  const { source, value } = await readFromSources(reader, args.source, {
    fxtwitter: (client) => readMediaFromFxTwitter(client, id),
    account: (accountReader) => readMediaFromAccount(accountReader, id, args.account),
  })
  if (value.status !== "ok") throw unavailableError(value.status, value.reason, source)

  const { quote } = value
  const planned = [...planItems(id, value.items), ...(args.quoted && quote ? planItems(quote.id, quote.items) : [])]
  if (planned.length === 0) throw nothingToSave(!args.quoted && quote !== null && quote.items.length > 0)
  return { planned, source }
}

/**
 * Downloads the planned items one after another into `folder`. An abort ends
 * the call at once and a failure that is not a `ToolError` is a bug; any other
 * failure is listed under `failed`, and the first of them comes back with it.
 */
async function downloadAll(
  planned: readonly PlannedItem[],
  folder: string,
  ctx: ToolContext,
  userAgent: string,
  overrides: DownloadOverrides,
): Promise<{ files: SavedFile[]; failed: FailedFile[]; firstFailure: ToolError | undefined }> {
  const files: SavedFile[] = []
  const failed: FailedFile[] = []
  let firstFailure: ToolError | undefined
  for (const { from, kind, url, stem } of planned) {
    try {
      if (url === null) throw noMp4Error()
      const saved = await downloadMedia(kind === "photo" ? originalPhotoUrl(url) : url, kind, folder, stem, {
        userAgent,
        signal: ctx.signal,
        ...overrides,
      })
      files.push({ path: saved.path, kind, from, bytes: saved.bytes, reused: saved.reused })
    } catch (error) {
      if (isAbortError(error) || !isToolError(error)) throw error
      firstFailure ??= error
      failed.push({ from, kind, error: `${error.code}: ${error.message}` })
    }
  }
  return { files, failed, firstFailure }
}

/**
 * Saves the media of one post (and of the post it quotes when `quoted`) into
 * `<download directory>/<post id>/`, as `<post id>-<n>.<ext>`.
 *
 * The download directory and the post's folder are made and checked first
 * (`forbidden` for a place the tools keep their own files or a folder that is a
 * link); the post is then read once, as `x_post_read`'s `view` reads it. A post
 * that is not available, and one with no photo, video or GIF, is `not_found`.
 * The files come one after another: a failure is listed under `failed` and the
 * rest go on, but when nothing was saved or reused the first failure is thrown.
 * The post's folder is removed when this call made it and left it empty, on
 * every failure.
 */
export async function saveMedia(
  args: MediaDownloadInput,
  ctx: ToolContext,
  reader: Reader,
  overrides: DownloadOverrides = {},
): Promise<MediaDownloadOutput> {
  const { id } = parsePostRef(args.post, "post")
  const downloadDir = requireDownloadDir(ctx)
  const { runtime } = requireRuntime(ctx, "Media downloads")

  const folder: PostFolder = await preparePostFolder(downloadDir, id, ctx)
  try {
    const { planned, source } = await planPost(args, id, reader)
    const { files, failed, firstFailure } = await downloadAll(planned, folder.path, ctx, runtime.userAgent, overrides)
    if (files.length === 0 && firstFailure) throw firstFailure
    return { post: id, folder: folder.path, files, failed, source, note: SAVED_MEDIA_NOTE }
  } catch (error) {
    await removeIfEmpty(folder)
    throw error
  }
}
