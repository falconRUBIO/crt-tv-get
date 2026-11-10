package tv.crt.test;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
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
 *
 * v0.7 changes over 0.6:
 *  - TV light mode in tv.js (no transitions/animations/shadows,
 *    content-visibility on guide rows) plus a preview-stall guard.
 *  - Debug status line hidden by default: 3s at launch, auto-shows while
 *    stalled, toggles with long-press Menu (bridged as 'MenuLong').
 *
 * v0.8 changes over 0.7 (low-end Fire Stick hardening):
 *  - WebView HTTP/database caches kept across launches (faster cold start).
 *  - tv.js: deferred+ slower auto-open (first painted frame before what's-on),
 *    guide preview decodes only while dwelling on a channel, preview freeze
 *    detection via currentTime, warm-start JSON fetch cache, update checks
 *    deferred 60-90s so nothing competes with startup.
 *  - v0.9: guide preview KEEPS PLAYING during navigation; its source only
 *    switches after a 1.2s dwell (no decoder churn while scrolling).
 */
public class MainActivity extends Activity {
    private static final String HOME_URL = "https://crt-tv-4ym.pages.dev/";
    private static final String UA = "Mozilla/5.0 (X11; Linux x86_64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.0 "
            + "Safari/537.36 CRTTV/0.9";

    private WebView webView;
    private FrameLayout customContainer;
    private View customView;

    // Short Menu press bridges 'Menu' (site menus / sports jump); holding Menu
    // for 600ms bridges 'MenuLong' (debug status-line toggle) and consumes
    // the release so the short action never fires.
    private static final long MENU_LONG_PRESS_MS = 600L;
    private final Handler menuHandler = new Handler(Looper.getMainLooper());
    private boolean menuLongFired;
    private final Runnable menuLongRunnable = () -> {
        menuLongFired = true;
        bridge("window.crtRemote && window.crtRemote('MenuLong')");
    };
    private WebChromeClient.CustomViewCallback customViewCallback;
    private WebChromeClient chromeClient;
    private long updateDownloadId = -1;

    private final BroadcastReceiver updateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != updateDownloadId) return;
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri uri = dm != null ? dm.getUriForDownloadedFile(id) : null;
            if (uri == null) return;
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(install);
            } catch (Exception ignored) {
            }
        }
    };

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
        // v0.8: keep HTTP/database caches across launches so a cold start
        // reuses the cached bundle and feed instead of refetching ~2 MB.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDatabaseEnabled(true);
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

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void installUpdate(String url) {
                startUpdateDownload(url);
            }

            @JavascriptInterface
            public String appVersion() {
                return "0.9";
            }
        }, "CrtNative");

        registerReceiver(updateReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

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
        // v0.8: returning from fullscreen tears down the custom surface; the
        // Fire OS WebView can leave the inline decoder attached to it (guide
        // preview plays ~30s then freezes). Resume and relayout the WebView
        // so inline video re-composites; tv.js also re-loads a frozen
        // preview once per channel dwell.
        webView.onResume();
        webView.requestLayout();
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

    private void startUpdateDownload(String url) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("CRT TV update");
            req.setDescription("Downloading the new CRT TV version");
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(this,
                    Environment.DIRECTORY_DOWNLOADS, "CRT-TV-update.apk");
            req.setMimeType("application/vnd.android.package-archive");
            updateDownloadId = dm.enqueue(req);
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

        if (code == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                menuLongFired = false;
                menuHandler.removeCallbacks(menuLongRunnable);
                menuHandler.postDelayed(menuLongRunnable, MENU_LONG_PRESS_MS);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                menuHandler.removeCallbacks(menuLongRunnable);
                if (!menuLongFired) {
                    bridge("window.crtRemote && window.crtRemote('Menu')");
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
        try {
            unregisterReceiver(updateReceiver);
        } catch (Exception ignored) {
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
