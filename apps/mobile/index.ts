import { registerRootComponent } from "expo";
// Define background location task before the app mounts (native only).
import "./src/lib/heartbeatTask";
import App from "./App";

registerRootComponent(App);
