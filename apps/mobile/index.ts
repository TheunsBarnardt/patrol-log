import "react-native-gesture-handler";
import { registerRootComponent } from "expo";
import App from "./App";

try {
  require("./src/lib/heartbeatTask");
} catch (err) {
  console.warn("[startup] heartbeat task skipped", err);
}

registerRootComponent(App);
