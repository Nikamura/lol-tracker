#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { addCmd } from "./commands/add.js";
import { listCmd } from "./commands/list.js";
import { pollCmd } from "./commands/poll.js";
import { removeCmd } from "./commands/remove.js";
import { serveCmd } from "./commands/serve.js";
import { timelineCmd } from "./commands/timeline.js";

const main = defineCommand({
  meta: {
    name: "lol-tracker",
    version: "0.1.0",
    description: "Track League of Legends games played by a list of friends.",
  },
  subCommands: {
    add: addCmd,
    remove: removeCmd,
    list: listCmd,
    poll: pollCmd,
    serve: serveCmd,
    timeline: timelineCmd,
  },
});

runMain(main);
