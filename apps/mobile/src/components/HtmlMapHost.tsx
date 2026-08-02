import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import WebView from "react-native-webview";

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
  { html, baseUrl = "https://openstreetmap.org", style, onLoad },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    injectJavaScript(script: string) {
      webViewRef.current?.injectJavaScript(script);
    },
  }));

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl }}
        style={styles.fill}
        onLoad={onLoad}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        startInLoadingState={false}
        scalesPageToFit={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  fill: { flex: 1, backgroundColor: "transparent" },
});
