import express from "express";
import dbConfig from "./config/db";
import ioConfig from "./config/ioConfig";
import pushConfig from "./config/pushConfig";
import configMiddlewares from "./config/middlewares";
import cors from "cors";
import http from "http";
import { initAmplitude, routeCreator } from "./lib";
import SocketIO from "socket.io";
import fs from "fs";

// use port from env or 4000 if it doesn't exist. feel free to change
const port = process.env.PORT || 4000;
const app = express();

let origin = [
  "http://localhost:5000",
  "http://localhost:3000",
  "http://127.0.0.1:8081",
  "http://localhost:8081",
  "http://localhost:3001",
  "https://admin.trally.com",
  "https://staging.trally.com",
  "https://app.trally.com",
  "https://www.app.trally.com",
];

// add your cors
app.use("*", cors({ origin }));

pushConfig();

dbConfig(app);
// app.use(express.static(path.join(__dirname, './web/build')))
configMiddlewares(app);

// for setting up ios dynamic links, this is required
app.get("/apple-app-site-association", (req, res) => {
  res.sendFile(`${process.cwd()}/lib/apple-app-site-association.json`);
});

/*
  routeCreator reads every folder in API, loops in them
  then for each file dynamically generates endpoints
*/
app.use(routeCreator());

const server = http.Server(app);
// export const io = new SocketIO(server)
const io = SocketIO(server, {
  cors: {
    origin: "*",
  },
});

ioConfig(io);

// inserts io to each route/to the app params
app.io = io;

//create tmp directory for web uploads
var dir = "./tmp";
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

//init amplitude for events
initAmplitude();

server.listen(port, () => console.log(`App listening on port ${port}`));
export default io;
