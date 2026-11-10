package tv.crt.test;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * CRT TV - thin Fire TV wrapper for https://crt-tv-4ym.pages.dev/
 *
 * v0.6 changes over 0.5:
 *  - D-pad keys pass through to the WebView as native trusted key events
 *    (zero bridge latency, no double handling; the site's own key handlers
 *    manage menus/guide). Only Back, Menu and media keys are bridged.
 *  - Proper onShowCustomView fullscreen: video fullscreen renders on a real
 *    surface instead of a broken hardware-overlay promotion (black picture,
 *    playing audio).
 *  - tv.js adds a CSS override that keeps inline video composited in-page.
 *  - Hourly hosted-update check repointed at files that exist (bundle.js).
 */
public class MainActivity extends Activity {
    private static final String HOME_URL = "https://crt-tv-4ym.pages.dev/";
    private static final String UA = "Mozilla/5.0 (X11; Linux x86_64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.0 "
            + "Safari/537.36 CRTTV/0.6";

    private WebView webView;
    private FrameLayout customContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private WebChromeClient chromeClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        customContainer = new FrameLayout(this);
        customContainer.setVisibility(View.GONE);
        customContainer.setBackgroundColor(0xFF000000);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(customContainer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(UA);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        chromeClient = new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                customContainer.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                customContainer.setVisibility(View.VISIBLE);
                webView.setVisibility(View.GONE);
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        };
        webView.setWebChromeClient(chromeClient);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                injectBridge();
            }
        });

        webView.loadUrl(HOME_URL);
    }

    private void hideCustomView() {
        if (customView == null) return;
        customContainer.removeView(customView);
        customContainer.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        customView = null;
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private void injectBridge() {
        try {
            InputStream in = getAssets().open("tv.js");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            webView.evaluateJavascript(out.toString("UTF-8"), null);
        } catch (Exception ignored) {
        }
    }

    private void bridge(String call) {
        webView.evaluateJavascript(call, null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();

        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP && event.getRepeatCount() == 0) {
                if (customView != null) {
                    hideCustomView();
                } else {
                    webView.evaluateJavascript(
                            "window.crtBack ? String(window.crtBack()) : 'false'",
                            value -> {
                                if (!"\"true\"".equals(value)) {
                                    if (webView.canGoBack()) webView.goBack(); else finish();
                                }
                            });
                }
            }
            return true;
        }

        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            String bridgeKey = null;
            switch (code) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: bridgeKey = "MediaPlayPause"; break;
                case KeyEvent.KEYCODE_MEDIA_REWIND: bridgeKey = "MediaRewind"; break;
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: bridgeKey = "MediaFastForward"; break;
                case KeyEvent.KEYCODE_MENU: bridgeKey = "Menu"; break;
                default: break;
            }
            if (bridgeKey != null) {
                bridge("window.crtRemote && window.crtRemote('" + bridgeKey + "')");
                return true;
            }
        }

        // Everything else (all D-pad keys, Enter, digits) goes straight to the
        // WebView as native trusted key events: zero bridge latency.
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        bridge("window.crtSuspend && window.crtSuspend()");
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
