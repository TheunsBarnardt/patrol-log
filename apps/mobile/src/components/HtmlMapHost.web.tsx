import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from "react";
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

export const HtmlMapHost = forwardRef<HtmlMapHostHandle, Props>(function HtmlMapHost(
  { html, style, onLoad },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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

  return (
    <View style={[styles.container, style]}>
      <iframe
        ref={iframeRef}
        title="map"
        srcDoc={html}
        style={webIframeStyle}
        onLoad={() => onLoad?.()}
        sandbox="allow-scripts allow-same-origin"
      />
    </View>
  );
});

const webIframeStyle: CSSProperties = {
  border: "none",
  width: "100%",
  height: "100%",
  display: "block",
  background: "transparent",
};

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
});
