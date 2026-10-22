// Site-wide fixes for every Leaflet map's fullscreen and popups.
//
// Load right after js/fluid-zoom.js (so after leaflet.js and the
// leaflet.fullscreen / gesture-handling plugins); every map created afterwards
// gets them through an init hook. The CSS is injected here, so a page needs
// only the one script tag.
//
//   • iPhone Safari has no element Fullscreen API, so leaflet.fullscreen falls
//     back to "pseudo-fullscreen": the map becomes position: fixed with
//     z-index 99999. That z-index only counts inside the map's own stacking
//     context, and every page wraps its maps in `.content` (z-index: 1), so the
//     fixed navbar (z-index 1000) and the app's tab bar (1100) were drawn over
//     the "fullscreen" map, and a page's own z-index / max-height on the map
//     (the ecoregion maps: z-index 0, capped at 800px) beat the plugin's
//     rule, leaving the page title on top and a strip of page below. While a map is
//     pseudo-fullscreen its ancestors are tagged so they stop forming stacking
//     contexts (or containing blocks, via transform/filter), and the page
//     behind it stops scrolling.
//   • The container gets `leaflet-is-fullscreen` in both modes. The plugin only
//     marks its own button (`.leaflet-fullscreen-on`), so CSS that wanted to
//     restyle a fullscreen map (css/leaflet.css shows phone legends again) never
//     matched.
//   • leaflet-gesture-handling's "use two fingers / ctrl + scroll" is pointless
//     once the map fills the screen, so it's switched off in fullscreen and
//     restored on exit. Some pages already did this by hand; this covers the
//     ones that didn't (the ecoregion maps) and is harmless alongside the rest.
//   • Popups auto-pan clear of the top-left zoom bar instead of opening
//     underneath it.

(function () {
    if (!window.L || !L.Map) return;

    const ANCESTOR = 'leaflet-pseudo-fullscreen-ancestor';
    const PAGE_OPEN = 'leaflet-pseudo-fullscreen-open';

    const css = `
.leaflet-pseudo-fullscreen {
    z-index: 99999 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    border-radius: 0 !important;
}
.leaflet-container:fullscreen { border-radius: 0 !important; }
.${ANCESTOR} {
    z-index: auto !important;
    transform: none !important;
    filter: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    perspective: none !important;
    contain: none !important;
    will-change: auto !important;
    isolation: auto !important;
    opacity: 1 !important;
}
html.${PAGE_OPEN} { overflow: hidden !important; }
`;
    const style = document.createElement('style');
    style.id = 'map-fixes-css';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    // The zoom bar is ~34px wide plus its 10px margin; leave a little air.
    L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(52, 10) });

    L.Map.addInitHook(function () {
        const map = this;
        let tagged = [];
        let restoreGestures = false;

        map.on('enterFullscreen', () => {
            const c = map.getContainer();
            c.classList.add('leaflet-is-fullscreen');

            const gh = map.gestureHandling;
            if (gh && gh.enabled()) { gh.disable(); restoreGestures = true; }

            if (c.classList.contains('leaflet-pseudo-fullscreen')) {
                for (let el = c.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
                    el.classList.add(ANCESTOR);
                    tagged.push(el);
                }
                document.documentElement.classList.add(PAGE_OPEN);
                map.invalidateSize();
            }
        });

        map.on('exitFullscreen', () => {
            map.getContainer().classList.remove('leaflet-is-fullscreen');
            if (tagged.length) {
                tagged.forEach(el => el.classList.remove(ANCESTOR));
                tagged = [];
                if (!document.querySelector('.leaflet-pseudo-fullscreen')) {
                    document.documentElement.classList.remove(PAGE_OPEN);
                }
                map.invalidateSize();
            }
            if (restoreGestures && map.gestureHandling) map.gestureHandling.enable();
            restoreGestures = false;
        });
    });
})();
