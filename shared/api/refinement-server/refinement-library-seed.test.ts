import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureRefinementLibraryForSubcategory,
  filterRefinementPlanBySemanticValidation,
  resolveSemanticallyValidatedRefinementPlan,
} from "./refinement-library-seed";

function makePlan(keys: string[]) {
  return {
    ok: true,
    components: keys.map((key, index) => ({
      key,
      label: key.replace(/_/g, " "),
      priority: index + 1,
      reason: `Visual choice for ${key}`,
    })),
    optionSeeds: keys.map((key) => ({
      componentKey: key,
      options: [
        {
          imagePrompt: `Photorealistic finished scene emphasizing ${key}`,
          label: `${key} option`,
          value: `${key}_option`,
        },
      ],
    })),
  };
}

function scorePlan(keys: string[], scores: Record<string, number>) {
  return keys.map((key) => ({
    key,
    reason: `Grounded score for ${key}`,
    relevanceScore: scores[key] ?? 0.9,
  }));
}

test("semantic filtering accepts 0.75, rejects below it, and filters option seeds", () => {
  const keys = ["vanity", "shower_tile", "flooring", "lighting", "pavers"];
  const filtered = filterRefinementPlanBySemanticValidation({
    planJson: makePlan(keys),
    results: scorePlan(keys, { pavers: 0.749, shower_tile: 0.75 }),
  });

  assert.equal(filtered.ok, true);
  if (!filtered.ok) return;
  assert.deepEqual(filtered.components.map((component) => component.key), [
    "vanity",
    "shower_tile",
    "flooring",
    "lighting",
  ]);
  assert.deepEqual(filtered.rejectedKeys, ["pavers"]);
  assert.deepEqual(filtered.optionSeeds.map((group) => group.componentKey), [
    "vanity",
    "shower_tile",
    "flooring",
    "lighting",
  ]);
});

test("four valid components publish without a replan", async () => {
  const keys = ["vanity", "shower_tile", "flooring", "lighting", "pavers"];
  let validationCalls = 0;
  let replanCalls = 0;

  const resolved = await resolveSemanticallyValidatedRefinementPlan({
    initialPlanJson: makePlan(keys),
    replan: async () => {
      replanCalls += 1;
      return { error: "unexpected", ok: false };
    },
    validate: async (components) => {
      validationCalls += 1;
      return {
        ok: true,
        results: scorePlan(components.map((component) => component.key), { pavers: 0.2 }),
      };
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(validationCalls, 1);
  assert.equal(replanCalls, 0);
  assert.equal(resolved.semanticReplanCalled, false);
});

test("fewer than four survivors causes exactly one replan excluding rejected keys", async () => {
  const firstKeys = ["vanity", "shower_tile", "pavers", "outdoor_lighting", "walkway"];
  const secondKeys = ["vanity", "shower_tile", "flooring", "lighting", "countertops"];
  let validationCalls = 0;
  let replanCalls = 0;

  const resolved = await resolveSemanticallyValidatedRefinementPlan({
    initialPlanJson: makePlan(firstKeys),
    replan: async ({ acceptedComponents, excludedComponentKeys }) => {
      replanCalls += 1;
      assert.deepEqual(acceptedComponents.map((component) => component.key), ["vanity", "shower_tile"]);
      assert.deepEqual(excludedComponentKeys, ["pavers", "outdoor_lighting", "walkway"]);
      return { json: makePlan(secondKeys), ok: true };
    },
    validate: async (components) => {
      validationCalls += 1;
      const keys = components.map((component) => component.key);
      return {
        ok: true,
        results: scorePlan(
          keys,
          validationCalls === 1
            ? { outdoor_lighting: 0.05, pavers: 0.1, walkway: 0.05 }
            : {},
        ),
      };
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(replanCalls, 1);
  assert.equal(validationCalls, 2);
  assert.equal(resolved.semanticReplanCalled, true);
  if (resolved.ok) {
    assert.deepEqual(resolved.components.map((component) => component.key), secondKeys);
  }
});

test("an underfilled second validation fails after one replan", async () => {
  const keys = ["vanity", "shower_tile", "pavers", "outdoor_lighting", "walkway"];
  let replanCalls = 0;

  const resolved = await resolveSemanticallyValidatedRefinementPlan({
    initialPlanJson: makePlan(keys),
    replan: async () => {
      replanCalls += 1;
      return { json: makePlan(keys), ok: true };
    },
    validate: async (components) => ({
      ok: true,
      results: scorePlan(components.map((component) => component.key), {
        outdoor_lighting: 0.05,
        pavers: 0.1,
        walkway: 0.05,
      }),
    }),
  });

  assert.deepEqual(resolved, {
    error: "refinement_semantic_insufficient",
    ok: false,
    semanticReplanCalled: true,
  });
  assert.equal(replanCalls, 1);
});

test("validator failure exits without invoking the replan callback", async () => {
  let replanCalls = 0;
  const resolved = await resolveSemanticallyValidatedRefinementPlan({
    initialPlanJson: makePlan(["vanity", "tile", "flooring", "lighting"]),
    replan: async () => {
      replanCalls += 1;
      return { error: "unexpected", ok: false };
    },
    validate: async () => ({ error: "validator unavailable", ok: false }),
  });

  assert.deepEqual(resolved, {
    error: "refinement_semantic_validation_failed",
    ok: false,
    semanticReplanCalled: false,
  });
  assert.equal(replanCalls, 0);
});

test("publisher performs no database or storage mutations when semantic validation fails", async () => {
  const mutationCounts = { delete: 0, insert: 0, storage: 0, update: 0 };
  const queryBuilder = () => {
    const builder: any = {
      contains: () => builder,
      delete: () => {
        mutationCounts.delete += 1;
        return builder;
      },
      eq: () => builder,
      insert: () => {
        mutationCounts.insert += 1;
        return builder;
      },
      is: () => builder,
      limit: () => builder,
      order: () => builder,
      select: () => builder,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
      update: () => {
        mutationCounts.update += 1;
        return builder;
      },
    };
    return builder;
  };
  const supabase = {
    from: () => queryBuilder(),
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove: async () => {
          mutationCounts.storage += 1;
          return { data: null, error: null };
        },
        upload: async () => {
          mutationCounts.storage += 1;
          return { data: null, error: null };
        },
      }),
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/api/refinement-library-planner/plan")) {
      return new Response(JSON.stringify(makePlan(["vanity", "tile", "flooring", "lighting"])), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    if (url.endsWith("/v1/api/refinement-library-planner/validate-components")) {
      return new Response(JSON.stringify({ error: "validator unavailable", ok: false }), {
        headers: { "content-type": "application/json" },
        status: 503,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await ensureRefinementLibraryForSubcategory({
      baseUrls: ["http://planner.test"],
      categoryName: "Remodeling",
      existingSubcategoryComponents: [],
      mode: "instance_seed",
      serviceSummary: "Interior bathroom remodeling.",
      subcategoryId: "bathroom-id",
      subcategoryName: "Bathroom Remodeling",
      supabase,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "refinement_semantic_validation_failed");
    assert.deepEqual(mutationCounts, { delete: 0, insert: 0, storage: 0, update: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
