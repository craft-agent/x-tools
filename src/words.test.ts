import { describe, expect, test } from "bun:test"
import { translator } from "./core"
import { FACT_TRANSLATIONS } from "./core/facts"
import { MEDIA_HEADLINE, MEDIA_HEADLINE_QUOTED, MEDIA_INTENT, MEDIA_TITLE } from "./core/media/words"
import { ALL_TRANSLATIONS } from "./words"

describe("ALL_TRANSLATIONS", () => {
  test("holds the shared fact words in Japanese", () => {
    expect(ALL_TRANSLATIONS.ja).toMatchObject(FACT_TRANSLATIONS.ja!)
    expect(ALL_TRANSLATIONS.ja!.Size).toBe("サイズ")
  })

  test("holds the media tool's title, intent and headlines in Japanese, with their placeholders", () => {
    const ja = translator(ALL_TRANSLATIONS, "ja")
    expect(ja.word(MEDIA_TITLE)).not.toBe(MEDIA_TITLE)
    expect(ja.word(MEDIA_INTENT)).not.toBe(MEDIA_INTENT)
    for (const headline of [MEDIA_HEADLINE, MEDIA_HEADLINE_QUOTED]) {
      const translated = ja.template(headline)
      expect(translated).not.toBe(headline)
      expect(translated).toContain("{post}")
    }
  })
})
