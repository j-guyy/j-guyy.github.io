// Onward navigation for trip report pages.
// Appends "All adventures" plus previous / next report links to the end of
// .content, using the order of data/adventures.js (loaded before this file).
// Does nothing if the data is missing or this page is not in the list.

(function () {
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    // 'trip-reports/mount-hood.html' or '/trip-reports/mount-hood' -> 'mount-hood'
    function pageKey(path) {
        const file = String(path).split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
        return file.replace(/\.html$/i, '').toLowerCase();
    }

    function linkHtml(report, className, label) {
        return `
            <a class="report-nav-link ${className}" href="../${escapeHtml(report.link)}">
                <span class="report-nav-label">${label}</span>
                <span class="report-nav-title">${escapeHtml(report.navTitle || report.title)}</span>
            </a>`;
    }

    function init() {
        try {
            if (typeof adventureData === 'undefined' || !adventureData || !adventureData.categories) return;
            const content = document.querySelector('.content');
            if (!content || content.querySelector('.report-nav')) return;

            // Every adventure that has a real report page, in data order, once each.
            const seen = new Set();
            const reports = Object.values(adventureData.categories)
                .flat()
                .filter(a => a && a.title && a.link && a.link !== '#')
                .filter(a => (seen.has(a.link) ? false : seen.add(a.link)));

            const current = pageKey(window.location.pathname);
            const index = reports.findIndex(a => pageKey(a.link) === current);
            if (!current || index === -1) return;

            const prev = reports[index - 1];
            const next = reports[index + 1];

            const nav = document.createElement('nav');
            nav.className = 'report-nav';
            nav.setAttribute('aria-label', 'More trip reports');
            nav.innerHTML = `
            <a class="report-nav-all" href="../adventures.html">← All adventures</a>
            <div class="report-nav-links">${prev ? linkHtml(prev, 'report-nav-prev', '← Previous') : ''}${next ? linkHtml(next, 'report-nav-next', 'Next →') : ''}
            </div>`;
            content.appendChild(nav);
        } catch (error) {
            // Navigation is an extra; never break the report over it.
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
