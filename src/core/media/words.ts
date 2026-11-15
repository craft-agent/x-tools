import type { Translations } from "../words"

/** The English words of `x_media_download`'s approval prompt, which its translations are keyed by. */
export const MEDIA_TITLE = "Save X media"
export const MEDIA_INTENT = "About to save a post's media"
export const MEDIA_HEADLINE = "About to save the media of post {post}"
export const MEDIA_HEADLINE_QUOTED = "About to save the media of post {post} and of the post it quotes"

/** The translations of the words above. */
export const MEDIA_TRANSLATIONS: Translations = {
  ja: {
    [MEDIA_TITLE]: "X のメディアを保存",
    [MEDIA_INTENT]: "投稿のメディアを保存しようとしています",
    [MEDIA_HEADLINE]: "投稿 {post} のメディアを保存しようとしています",
    [MEDIA_HEADLINE_QUOTED]: "投稿 {post} と、それが引用している投稿のメディアを保存しようとしています",
  },
}
