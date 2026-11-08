import { describe, expect, it } from "vitest";
import type { SiteConfig } from "@pcms/shared";
import type { ContentItem } from "@pcms/shared";
import { faqJsonLd, localBusinessJsonLd, siteJsonLd } from "../src/jsonld.js";

const site = (business?: SiteConfig["business"]): SiteConfig => ({
  name: "サンプルカフェ",
  baseUrl: "https://example.com",
  logo: "/logo.png",
  business,
});

describe("localBusinessJsonLd", () => {
  it("returns null when no business info is set", () => {
    expect(localBusinessJsonLd(site())).toBeNull();
    expect(localBusinessJsonLd(site({}))).toBeNull();
  });

  it("builds a LocalBusiness with address, phone, hours and geo", () => {
    const obj = localBusinessJsonLd(
      site({
        type: "CafeOrCoffeeShop",
        streetAddress: "1-2-3",
        addressLocality: "渋谷区",
        addressRegion: "東京都",
        postalCode: "150-0001",
        telephone: "03-1234-5678",
        priceRange: "¥¥",
        openingHours: ["Mo-Fr 09:00-18:00"],
        latitude: 35.6,
        longitude: 139.7,
      }),
    ) as Record<string, unknown>;
    expect(obj["@type"]).toBe("CafeOrCoffeeShop");
    expect(obj.name).toBe("サンプルカフェ");
    expect(obj.url).toBe("https://example.com");
    expect(obj.image).toBe("https://example.com/logo.png");
    expect(obj.telephone).toBe("03-1234-5678");
    expect(obj.openingHours).toEqual(["Mo-Fr 09:00-18:00"]);
    expect(obj.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "渋谷区",
      addressCountry: "JP",
    });
    expect(obj.geo).toMatchObject({ "@type": "GeoCoordinates", latitude: 35.6, longitude: 139.7 });
  });

  it("emits when only a phone number is set", () => {
    expect(localBusinessJsonLd(site({ telephone: "03-0000-0000" }))).not.toBeNull();
  });

  it("is appended to the site-wide JSON-LD only when present", () => {
    expect(siteJsonLd(site())).toHaveLength(2);
    const withBiz = siteJsonLd(site({ telephone: "03-0000-0000" }));
    expect(withBiz).toHaveLength(3);
    expect((withBiz[2] as Record<string, unknown>)["@type"]).toBe("LocalBusiness");
  });
});

describe("faqJsonLd", () => {
  const item = (fields: Record<string, unknown>): ContentItem => ({
    type: "page",
    slug: "faq",
    fields: fields as never,
    body: "",
  });

  it("builds FAQPage from a group field of question/answer rows", () => {
    const obj = faqJsonLd(
      item({ faq: '[{"question":"営業時間は？","answer":"9時〜18時です。"}]' }),
    ) as Record<string, unknown>;
    expect(obj).not.toBeNull();
    expect(obj["@type"]).toBe("FAQPage");
    const entity = (obj.mainEntity as Record<string, unknown>[])[0]!;
    expect(entity.name).toBe("営業時間は？");
    expect((entity.acceptedAnswer as Record<string, unknown>).text).toBe("9時〜18時です。");
  });

  it("accepts 質問/回答 keys and returns null without a complete pair", () => {
    expect(faqJsonLd(item({ x: '[{"質問":"Q","回答":"A"}]' }))).not.toBeNull();
    expect(faqJsonLd(item({ x: '[{"question":"only-q"}]' }))).toBeNull();
    expect(faqJsonLd(item({ title: "ただの文字列" }))).toBeNull();
  });
});
