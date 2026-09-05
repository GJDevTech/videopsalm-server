"use strict";

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const MAX_CHURCH_ID_LENGTH = 128;
const CHURCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function normalizeChurchId(value) {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > MAX_CHURCH_ID_LENGTH ||
    !CHURCH_ID_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function churchRoom(churchId) {
  return `church:${churchId}`;
}

function safeString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function stripChords(value) {
  return safeString(value).replace(/\[[^\]]+\]/g, "");
}

function legacyCue(body) {
  if (body.Clear) {
    return { version: 2, mode: "CLEAR", text: "", settings: {} };
  }
  if (body.Timer) {
    return {
      version: 2,
      mode: "LIVE",
      kind: "timer",
      text: safeString(body.Timer),
      textHidden: false,
      logoVisible: false,
      settings: {
        fontFamily: "Arial",
        fontSize: 150,
        bold: true,
        textColor: "#ff3b30",
        backgroundColor: "#000000",
        textHorizontalAlign: "center",
        textVerticalAlign: "center",
        textBoxX: 5,
        textBoxY: 5,
        textBoxWidth: 90,
        textBoxHeight: 90,
      },
    };
  }

  const verses = Array.isArray(body.SongVerses) ? body.SongVerses : [];
  const index = Math.max(0, Number.parseInt(body.CurrentItemIndex, 10) - 1 || 0);
  const current = verses[index] || {};
  const next = verses[index + 1] || {};
  const next2 = verses[index + 2] || {};
  return {
    version: 2,
    mode: "LIVE",
    kind: "lyrics",
    title: safeString(body.Title),
    segment: safeString(current.Title),
    text: stripChords(current.Lyrics),
    chordText: safeString(current.Lyrics),
    nextText: stripChords(next.Lyrics),
    nextChordText: safeString(next.Lyrics),
    next2Text: stripChords(next2.Lyrics),
    next2ChordText: safeString(next2.Lyrics),
    textHidden: false,
    logoVisible: false,
    settings:
      body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
        ? body.settings
        : {},
  };
}

function validCue(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tokenMatches(expected, provided) {
  if (!expected) return true;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createStageServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const controlToken = String(
    options.controlToken ?? process.env.STAGE_CUE_CONTROL_TOKEN ?? ""
  ).trim();
  const churchStates = new Map();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  function authorized(req) {
    const authorization = safeString(req.get("authorization"));
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    return tokenMatches(controlToken, supplied);
  }

  function requestChurchId(req) {
    return normalizeChurchId(
      req.params.churchId ||
        req.body?.churchId ||
        req.query.churchId ||
        req.get("x-stage-cue-church-id")
    );
  }

  function publishCue(churchId, cue) {
    const previousRevision = churchStates.get(churchId)?.serverRevision || 0;
    const published = {
      ...cue,
      version: Number(cue.version) || 2,
      churchId,
      instanceId: churchId,
      serverRevision: previousRevision + 1,
      publishedAt: new Date().toISOString(),
    };
    churchStates.set(churchId, published);
    io.to(churchRoom(churchId)).emit("cue-update", published);
    return published;
  }

  function acceptCue(req, res, cue) {
    if (!authorized(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const churchId = requestChurchId(req);
    if (!churchId) {
      return res.status(400).json({
        error: "A valid MongoDB church ID is required.",
      });
    }
    if (!validCue(cue)) {
      return res.status(400).json({ error: "A cue object is required." });
    }
    const published = publishCue(churchId, cue);
    return res.json({
      success: true,
      churchId,
      instanceId: churchId,
      serverRevision: published.serverRevision,
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", activeChurches: churchStates.size });
  });

  app.post("/api/churches/:churchId/cue", (req, res) => {
    return acceptCue(req, res, req.body?.cue ?? req.body);
  });

  // Transitional body-routed endpoint for clients that already send churchId.
  app.post("/api/cue", (req, res) => {
    return acceptCue(req, res, req.body?.cue);
  });

  // Legacy VideoPsalm payload compatibility; the caller must identify a church.
  app.post("/update-slide", (req, res) => {
    return acceptCue(req, res, legacyCue(req.body || {}));
  });

  app.get(["/stage-view", "/stage-view/:churchId"], (_req, res) => {
    res.sendFile(path.join(__dirname, "views", "stage-view.html"));
  });

  app.get(["/chords-view", "/chords-view/:churchId"], (_req, res) => {
    res.sendFile(path.join(__dirname, "views", "chords-view.html"));
  });

  io.on("connection", (socket) => {
    const churchId = normalizeChurchId(
      socket.handshake.auth?.churchId || socket.handshake.query?.churchId
    );
    if (!churchId) {
      socket.emit("instance-error", {
        error: "Open this page using a valid church presentation URL.",
      });
      socket.disconnect(true);
      return;
    }
    socket.join(churchRoom(churchId));
    const current = churchStates.get(churchId);
    if (current) socket.emit("cue-update", current);
  });

  return { app, server, io, churchStates, publishCue };
}

if (require.main === module) {
  const { server } = createStageServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Stage Cue server listening on ${port}`);
  });
}

module.exports = {
  createStageServer,
  legacyCue,
  normalizeChurchId,
};
