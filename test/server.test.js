"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createStageServer,
  legacyCue,
  normalizeChurchId,
} = require("../server");

async function withServer(callback) {
  const instance = createStageServer({ controlToken: "test-secret" });
  await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve));
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await callback(instance, origin);
  } finally {
    await new Promise((resolve) => instance.io.close(resolve));
  }
}

test("church IDs are stable URL-safe MongoDB identifiers", () => {
  assert.equal(normalizeChurchId(" 64f1ab2290d9aa0012345678 "), "64f1ab2290d9aa0012345678");
  assert.equal(normalizeChurchId("church_demo-1"), "church_demo-1");
  assert.equal(normalizeChurchId(""), null);
  assert.equal(normalizeChurchId("church/other"), null);
});

test("legacy VideoPsalm data is converted without chords in the stage text", () => {
  const cue = legacyCue({
    Title: "Song",
    CurrentItemIndex: 1,
    SongVerses: [{ Title: "Verse 1", Lyrics: "[C]Praise [G]the Lord" }],
  });
  assert.equal(cue.title, "Song");
  assert.equal(cue.segment, "Verse 1");
  assert.equal(cue.text, "Praise the Lord");
  assert.equal(cue.chordText, "[C]Praise [G]the Lord");
});

test("cue writes require authorization and a valid church ID", async () => {
  await withServer(async (_instance, origin) => {
    const unauthorized = await fetch(`${origin}/api/churches/church-one/cue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cue: { mode: "LIVE", text: "No" } }),
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${origin}/api/churches/not.valid/cue`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ cue: { mode: "LIVE", text: "No" } }),
    });
    assert.equal(invalid.status, 400);
  });
});

test("church presentation states are isolated and keep their church ID", async () => {
  await withServer(async (instance, origin) => {
    async function send(churchId, text) {
      return fetch(`${origin}/api/churches/${churchId}/cue`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ cue: { version: 2, mode: "LIVE", text } }),
      });
    }

    const first = await send("church-one", "First church");
    const second = await fetch(`${origin}/api/churches/church-two/cue`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cue: {
          version: 2,
          mode: "LIVE",
          text: "Second church",
          nextText: "Next slide lyrics",
          upcomingSlides: [
            { text: "Next slide lyrics", segment: "Chorus" },
            { text: "Later lyrics", segment: "Bridge" },
          ],
          settings: {
            textColor: "#00ff00",
            textBoxX: 12,
            nextSlideCount: 2,
          },
        },
      }),
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(instance.churchStates.size, 2);
    assert.equal(instance.churchStates.get("church-one").text, "First church");
    assert.equal(instance.churchStates.get("church-two").text, "Second church");
    assert.equal(instance.churchStates.get("church-two").settings.textColor, "#00ff00");
    assert.equal(instance.churchStates.get("church-two").settings.nextSlideCount, 2);
    assert.equal(instance.churchStates.get("church-two").nextText, "Next slide lyrics");
    assert.equal(instance.churchStates.get("church-two").upcomingSlides.length, 2);
    assert.equal(instance.churchStates.get("church-one").instanceId, "church-one");

    const updated = await send("church-one", "Updated");
    assert.equal((await updated.json()).serverRevision, 2);
    assert.equal(instance.churchStates.get("church-two").serverRevision, 1);

    const health = await (await fetch(`${origin}/health`)).json();
    assert.equal(health.activeChurches, 2);
    const viewer = await (await fetch(`${origin}/stage-view/church-one`)).text();
    assert.match(viewer, /cue-update/);
    assert.match(viewer, /white-space: pre/);
    assert.match(viewer, /outlineEnabled/);
    assert.doesNotMatch(viewer, /id="logo"/);
    assert.match(viewer, /nextSlideCount/);
    assert.match(viewer, /upcomingSlides/);
    assert.match(viewer, /Math\.pow\(0\.82, index\)/);
  });
});
