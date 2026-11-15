import { mergeTranslations, type Translations } from "./core"
import { FACT_TRANSLATIONS } from "./core/facts"
import { MEDIA_TRANSLATIONS } from "./core/media/words"

/** The translations of every tool's words, per language, which the native plugins use in their approval prompts. */
export const ALL_TRANSLATIONS: Translations = mergeTranslations(FACT_TRANSLATIONS, MEDIA_TRANSLATIONS)
