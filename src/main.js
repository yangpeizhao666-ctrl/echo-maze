import { EchoMazeGame } from "./game.js";
import "./styles.css";

const root = document.querySelector("#game-root");
const game = new EchoMazeGame(root);
window.echoMaze = game;

try {
  game.start();
} catch (error) {
  console.error(error);
  const prompt = document.querySelector("#promptText");
  if (prompt) prompt.textContent = error instanceof Error ? error.message : "Game boot failed.";
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline caching is optional; the game still runs normally without it.
    });
  });
}
