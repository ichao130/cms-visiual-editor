import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "../src/index.js";

describe("parseFrontMatter", () => {
  it("parses scalars and leaves the body intact", () => {
    const { data, body } = parseFrontMatter(
      ["---", "title: こんにちは", "draft: false", "views: 12", "---", "", "本文です。"].join(
        "\n",
      ),
    );
    expect(data).toEqual({ title: "こんにちは", draft: false, views: 12 });
    expect(body.trim()).toBe("本文です。");
  });

  it("parses inline and block lists", () => {
    const { data } = parseFrontMatter(
      ["---", "tags: [coffee, cafe]", "authors:", "  - 田中", "  - 佐藤", "---", "x"].join(
        "\n",
      ),
    );
    expect(data.tags).toEqual(["coffee", "cafe"]);
    expect(data.authors).toEqual(["田中", "佐藤"]);
  });

  it("returns the whole input as body when there is no front matter", () => {
    const { data, body } = parseFrontMatter("ただの本文");
    expect(data).toEqual({});
    expect(body).toBe("ただの本文");
  });
});
