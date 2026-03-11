const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// store latest slide data
let slideState = { SongVerses: [], CurrentItemIndex: 1, Title: "" };

// endpoint VideoPsalm posts to
app.post("/update-slide", (req, res) => {
    console.log(req.body);
    slideState = req.body;
    io.emit("slide-update", slideState); // broadcast to all clients
    res.json({ success: true });
});

// stage-view (no chords)
app.get("/stage-view", (req, res) => {
    res.sendFile(path.join(__dirname, "views/stage-view.html"));
});

// chords-view (with chords)
app.get("/chords-view", (req, res) => {
    res.sendFile(path.join(__dirname, "views/chords-view.html"));
});

io.on("connection", socket => {
    socket.emit("slide-update", slideState);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});