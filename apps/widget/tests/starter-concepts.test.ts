import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDIO_STARTER_CONCEPT_MAX_COUNT,
  STUDIO_STARTER_CONCEPT_MIN_COUNT,
  buildStudioStarterConcepts,
  type StarterConceptServiceInput,
} from "../lib/studio/starter-concepts";

function styles(prefix: string, count: number, serviceUrlPrefix = prefix.toLowerCase()) {
  return Array.from({ length: count }, (_, index) => ({
    imageId: `${prefix}-image-${index + 1}`,
    catalogKey: `${prefix}-catalog-${index + 1}`,
    value: `${prefix.toLowerCase()}-${index + 1}`,
    label: `${prefix} ${index + 1}`,
    imageUrl: `https://cdn.example.com/${serviceUrlPrefix}-${index + 1}.webp`,
    featuredRank: index + 1,
    catalogSource: index % 2 === 0 ? "account" : "global",
  }));
}

test("buildStudioStarterConcepts returns a stable 6-8 item flat projection with service provenance", () => {
  const services: StarterConceptServiceInput[] = [
    {
      value: "service-b",
      label: "Beta service",
      industryId: "industry-b",
      industryName: "Beta industry",
      styleOptions: styles("B", 6),
    },
    {
      value: "service-a",
      label: "Alpha service",
      serviceName: "Alpha design",
      industryId: "industry-a",
      industryName: "Alpha industry",
      styleOptions: styles("A", 6),
    },
  ];

  const first = buildStudioStarterConcepts(services);
  const second = buildStudioStarterConcepts([...services].reverse());

  assert.equal(first.length, STUDIO_STARTER_CONCEPT_MAX_COUNT);
  assert.ok(first.length >= STUDIO_STARTER_CONCEPT_MIN_COUNT);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map((concept) => concept.serviceId),
    ["service-a", "service-b", "service-a", "service-b", "service-a", "service-b", "service-a", "service-b"],
  );
  assert.equal(first[0]?.id, "service-a:A-image-1");
  assert.equal(first[0]?.serviceName, "Alpha design");
  assert.equal(first[0]?.industryId, "industry-a");
  assert.equal(first[0]?.catalogSource, "account");
});

test("explicit featured ranks win while unranked concepts remain deterministic", () => {
  const concepts = buildStudioStarterConcepts([
    {
      value: "service-a",
      label: "Alpha",
      styleOptions: [
        { value: "z", label: "Zulu", imageUrl: "https://cdn.example.com/z.webp" },
        { value: "rank-2", label: "Second", imageUrl: "https://cdn.example.com/2.webp", featuredRank: 2 },
        { value: "a", label: "Alpha", imageUrl: "https://cdn.example.com/a.webp" },
        { value: "rank-1", label: "First", imageUrl: "https://cdn.example.com/1.webp", featuredRank: 1 },
      ],
    },
  ]);

  assert.deepEqual(
    concepts.map((concept) => concept.value),
    ["rank-1", "rank-2", "a", "z"],
  );
  assert.equal(concepts[0]?.id, "service-a:rank-1");
});

test("unsafe or malformed imagery is omitted and a short safe catalog degrades without invented duplicates", () => {
  const concepts = buildStudioStarterConcepts([
    {
      value: "service-a",
      label: "Alpha",
      styleOptions: [
        { value: "safe", label: "Safe", imageUrl: "https://cdn.example.com/shared.webp" },
        { value: "inline", label: "Inline", imageUrl: "data:image/png;base64,abc" },
        { value: "active", label: "Active", imageUrl: "javascript:alert(1)" },
        { value: "relative", label: "Relative", imageUrl: "/catalog/relative.webp" },
        { value: "missing-image", label: "Missing image" },
      ],
    },
    {
      value: "service-b",
      label: "Beta",
      styleOptions: [
        { value: "duplicate", label: "Duplicate", imageUrl: "https://cdn.example.com/shared.webp" },
        { value: "safe-b", label: "Safe B", imageUrl: "http://localhost:3001/catalog/b.webp" },
      ],
    },
  ]);

  assert.deepEqual(
    concepts.map((concept) => concept.imageUrl),
    [
      "/catalog/relative.webp",
      "https://cdn.example.com/shared.webp",
      "http://localhost:3001/catalog/b.webp",
    ],
  );
  assert.equal(new Set(concepts.map((concept) => concept.imageUrl)).size, concepts.length);
  assert.ok(concepts.length < STUDIO_STARTER_CONCEPT_MIN_COUNT);
});

test("the caller limit is bounded by the Studio maximum", () => {
  const services: StarterConceptServiceInput[] = [
    { value: "service-a", label: "Alpha", styleOptions: styles("A", 12) },
  ];

  assert.equal(buildStudioStarterConcepts(services, 3).length, 3);
  assert.equal(buildStudioStarterConcepts(services, 99).length, STUDIO_STARTER_CONCEPT_MAX_COUNT);
  assert.deepEqual(buildStudioStarterConcepts(null), []);
});
