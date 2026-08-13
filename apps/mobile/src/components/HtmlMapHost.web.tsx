import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

export type HtmlMapHostHandle = {
  injectJavaScript: (script: string) => void;
};

type Props = {
  html: string;
  baseUrl?: string;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
};

const INVALIDATE = "try{if(typeof map!=='undefined')map.invalidateSize({animate:false});}catch(e){}";

export const HtmlMapHost = forwardRef<HtmlMapHostHandle, Props>(function HtmlMapHost(
  { html, style, onLoad },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Freeze srcDoc after mount — React resetting srcDoc remounts the iframe
  // and mobile browsers often come back with a gray, empty Leaflet pane.
  const srcDocRef = useRef(html);

  useImperativeHandle(ref, () => ({
    injectJavaScript(script: string) {
      const win = iframeRef.current?.contentWindow as (Window & { eval: (s: string) => unknown }) | null;
      if (!win) return;
      try {
        win.eval(script.replace(/;\s*true;\s*$/, ";"));
      } catch (err) {
        console.warn("[HtmlMapHost] inject failed", err);
      }
    },
  }));

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const win = iframeRef.current?.contentWindow as (Window & { eval: (s: string) => unknown }) | null;
      try {
        win?.eval(INVALIDATE);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onVis);
    };
  }, []);

  return (
    <View style={[styles.container, style]}>
      <iframe
        ref={iframeRef}
        title="map"
        srcDoc={srcDocRef.current}
        style={webIframeStyle}
        onLoad={() => onLoad?.()}
        sandbox="allow-scripts allow-same-origin"
      />
    </View>
  );
});

const webIframeStyle: CSSProperties = {
  border: "none",
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  background: "#e8e0d8",
};

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#e8e0d8", position: "relative" },
});
