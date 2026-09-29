import "./build-site.mjs";
import { createGameServer } from "@rarefriends/friendsdk/serve";
const server = createGameServer("game/.friendsdk");
server.listen(4173, "127.0.0.1", () => console.log("Wallet game: http://localhost:4173 — run npm run build after edits, then refresh."));
