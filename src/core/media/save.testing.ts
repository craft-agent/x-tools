import type { ToolContext, ToolOptions } from "../tool"
import { accountPostData, readerAnswering, routePost } from "../posts/view.testing"
import { fxPhoto, fxStatus, fxVideo } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { startMediaFixture, type MediaFixture } from "./media.testing"
import { saveMedia } from "./save"
import type { MediaDownloadInput, MediaDownloadOutput } from "./schemas"

/** Fixtures the save tests share: the source fixture's fake FxTwitter and reading account, and a fake CDN whose temp directory is the download directory. */

export { fxPhoto, fxStatus, fxVideo, routePost }

/** A photo and a video of a post, on the real hosts; the fake CDN answers them by path. */
export const photoUrl = (name: string): string => `https://pbs.twimg.com/media/${name}.jpg`
export const videoUrl = (name: string): string => `https://video.twimg.com/ext_tw_video/1/pu/vid/${name}.mp4`

/** What a call is run with besides its arguments. */
export type SaveRun = {
  /** What the fake reading account answers a post id with; absent ids are answered `undefined`. */
  answers?: Record<string, unknown>
  options?: ToolOptions
  signal?: AbortSignal
  /** Replaces fields of the call's context, such as the directories to stay out of. */
  context?: Partial<ToolContext>
}

export type SaveFixture = {
  h: SourcesFixture
  cdn: MediaFixture
  /** The context of a call: the source fixture's, with the CDN's temp directory as `downloadDir`. */
  context(run?: SaveRun): ToolContext
  /** Saves the media of `args.post` against the fakes. */
  save(
    args: Partial<MediaDownloadInput> & Pick<MediaDownloadInput, "post">,
    run?: SaveRun,
  ): Promise<MediaDownloadOutput>
  /** The bridge's `post` data for `id` with the given media (and quote). */
  accountPost(id: string, media: { type: string; url: string }[], quote?: unknown): Record<string, unknown>
  dispose(): Promise<void>
}

export async function saveFixture(): Promise<SaveFixture> {
  const h = await sourcesFixture()
  const cdn = await startMediaFixture()
  const context = (run: SaveRun = {}): ToolContext => ({
    ...h.context(run.options),
    downloadDir: cdn.dir,
    ...(run.signal && { signal: run.signal }),
    ...run.context,
  })
  return {
    h,
    cdn,
    context,
    save: (args, run = {}) =>
      saveMedia(args, context(run), readerAnswering(h, run.answers ?? {}, run.options), { connect: cdn.connect }),
    accountPost: (id, media, quote) => ({ ...accountPostData(id), media, quote }),
    dispose: async () => {
      await cdn.stop()
      await h.dispose()
      await removeTempDirs()
    },
  }
}
