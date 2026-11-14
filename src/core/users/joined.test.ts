import { describe, expect, test } from "bun:test"
import { parseJoined } from "./joined"

describe("the join time as X writes it", () => {
  test("is read as ISO 8601 in UTC to the second", () => {
    expect(parseJoined("Wed Dec 19 20:20:32 +0000 2007")).toBe("2007-12-19T20:20:32Z")
    expect(parseJoined("Thu Mar 06 20:15:02 +0000 2008")).toBe("2008-03-06T20:15:02Z")
    expect(parseJoined("Sat Feb 29 00:00:00 +0000 2020")).toBe("2020-02-29T00:00:00Z")
  })

  test("moves an offset to UTC, across a day, a month and a year", () => {
    expect(parseJoined("Wed Dec 19 20:20:32 +0200 2007")).toBe("2007-12-19T18:20:32Z")
    expect(parseJoined("Wed Dec 19 20:20:32 -0530 2007")).toBe("2007-12-20T01:50:32Z")
    expect(parseJoined("Mon Jan 01 00:30:00 +0100 2018")).toBe("2017-12-31T23:30:00Z")
  })

  test("is null for text in another form", () => {
    for (const text of [
      "",
      "2007-12-19T20:20:32Z",
      "Wed Dec 19 20:20:32 2007",
      "Wed Dec 19 20:20:32 +0000 07",
      "Wed Dec 19 20:20:32 0000 2007",
      "Wed Dec 9 20:20:32 +0000 2007",
      "Wed December 19 20:20:32 +0000 2007",
      "Fri Dec 19 20:20:32 +0000 2007 ",
      "Wed dec 19 20:20:32 +0000 2007",
      "Wed Dec 19 20:20 +0000 2007",
    ]) {
      expect({ text, joined: parseJoined(text) }).toEqual({ text, joined: null })
    }
  })

  test("is null for a time that does not exist", () => {
    for (const text of [
      "Wed Feb 30 20:20:32 +0000 2007",
      "Wed Feb 29 20:20:32 +0000 2007",
      "Wed Dec 00 20:20:32 +0000 2007",
      "Wed Dec 32 20:20:32 +0000 2007",
      "Wed Dec 19 24:00:00 +0000 2007",
      "Wed Dec 19 20:60:32 +0000 2007",
      "Wed Dec 19 20:20:60 +0000 2007",
      "Wed Dec 19 20:20:32 +2400 2007",
      "Wed Dec 19 20:20:32 +0060 2007",
      "Wed Dec 19 20:20:32 +0000 0050",
    ]) {
      expect({ text, joined: parseJoined(text) }).toEqual({ text, joined: null })
    }
  })
})
