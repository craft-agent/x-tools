import { describe, expect, test } from "bun:test"
import { fxPost as fxPostAt } from "./fxtwitter"
import { NO_NOTE, READ_AT, UNKNOWN_NOTE, fxNote, fxStatus, unexpectedMatch } from "./posts.testing"
import { MAX_POST_TEXT } from "./shape"

const fxPost = (status: unknown) => fxPostAt(status, READ_AT)

describe("fxPost: the community note", () => {
  test("a note in the v2 form is shown with its text", () => {
    const post = fxPost(fxStatus({ community_note: fxNote("Context: the photo is from 2019.") }))
    expect(post.community_note).toEqual({ status: "shown", text: "Context: the photo is from 2019." })
    expect(post.clipped).toEqual([])
  })

  test("a note in the legacy form is shown with its text", () => {
    const post = fxPost(fxStatus({ community_note: fxNote("An older note.", "legacy") }))
    expect(post.community_note).toEqual({ status: "shown", text: "An older note." })
  })

  test("a null note is none", () => {
    expect(fxPost(fxStatus({ community_note: null })).community_note).toEqual(NO_NOTE)
  })

  test("a note FxTwitter leaves out is unknown, never none", () => {
    const { community_note: _note, ...status } = fxStatus()
    expect(fxPost(status).community_note).toEqual(UNKNOWN_NOTE)
    expect(fxPost({ ...status, community_note: undefined }).community_note).toEqual(UNKNOWN_NOTE)
  })

  test("a note with an empty text is still shown", () => {
    expect(fxPost(fxStatus({ community_note: fxNote("") })).community_note).toEqual({ status: "shown", text: "" })
  })

  test("a quote's own note is not read: the quote has none to hold", () => {
    const post = fxPost(fxStatus({ quote: fxStatus({ community_note: { text: 5 } }) }))
    expect(post.quote).not.toHaveProperty("community_note")
  })

  test("a note's text is clipped like the post's, and says where", () => {
    const post = fxPost(fxStatus({ community_note: fxNote("n".repeat(MAX_POST_TEXT + 1)) }))
    expect(post.community_note.text).toHaveLength(MAX_POST_TEXT)
    expect(post.clipped).toEqual(["community_note.text"])
  })
})

describe("fxPost: a note off shape", () => {
  const BROKEN: Record<string, unknown> = {
    "a note without a text": { facets: [] },
    "a note whose text is a number": { text: 5, facets: [] },
    "a note whose text is null": { text: null, facets: [] },
    "a note that is a string": "a note",
    "a note that is a list": [],
  }
  for (const [name, note] of Object.entries(BROKEN)) {
    test(`${name} is an unexpected_reply`, () => {
      expect(() => fxPost(fxStatus({ community_note: note }))).toThrow(
        expect.objectContaining(unexpectedMatch("fxtwitter")),
      )
    })
  }
})
