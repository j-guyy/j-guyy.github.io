// Shared progress + peak-card sync for the ADK 46ers and CO 14ers trip
// reports. Fetches live climbed state from the worker (KV) and re-homes the
// hardcoded peak cards so every climbed peak sits in the Summited section,
// even if its card has no date/note yet.
function initPeakTripReport(type, fallbackUrl) {
    TravelAPI.fetchPeaksWithFallback(type, fallbackUrl)
        .then(data => {
            const climbed = data.filter(p => p.climbed).length;
            const total = data.length;
            const pct = ((climbed / total) * 100).toFixed(1);
            const remaining = total - climbed;
            document.getElementById('progress-bar').style.width = pct + '%';
            document.getElementById('progress-bar').textContent = climbed + ' / ' + total;
            document.getElementById('progress-stats').innerHTML =
                '<div><span>' + climbed + '</span> Summited</div>' +
                '<div><span>' + remaining + '</span> Remaining</div>';

            const summitedGrid = document.getElementById('summited-grid');
            const remainingGrid = document.getElementById('remaining-grid');
            const peaksByName = new Map(data.map(p => [p.name, p]));

            const setBadge = (card, badge, cls, text) => {
                card.classList.remove('summited', 'bailed', 'partial');
                badge.classList.remove('summited', 'bailed', 'partial', 'not-yet');
                if (cls === 'summited') card.classList.add('summited');
                badge.classList.add(cls);
                badge.textContent = text;
            };

            // Insert keeping the remaining grid's elevation-descending order
            const insertByElevation = (card, elevation) => {
                const target = [...remainingGrid.querySelectorAll('.peak-card')].find(other => {
                    const otherPeak = peaksByName.get(other.querySelector('h3')?.textContent.trim());
                    return otherPeak && otherPeak.elevation < elevation;
                });
                remainingGrid.insertBefore(card, target || null);
            };

            document.querySelectorAll('.peak-card').forEach(card => {
                const heading = card.querySelector('h3');
                const badge = card.querySelector('.peak-badge');
                if (!heading || !badge) return;
                const peak = peaksByName.get(heading.textContent.trim());
                if (!peak) return;

                if (peak.climbed) {
                    setBadge(card, badge, 'summited', 'Summited');
                    if (card.parentElement !== summitedGrid) summitedGrid.appendChild(card);
                } else if (card.parentElement === summitedGrid) {
                    // Un-toggled peak: send it back to Remaining
                    setBadge(card, badge, 'not-yet', 'Not Yet');
                    insertByElevation(card, peak.elevation);
                }
                // Not climbed and not in Summited (Remaining or Attempted):
                // leave position and badge (Not Yet / Bailed / Partial) as-is.
            });

            // Hide a section entirely when its grid empties out
            [summitedGrid, remainingGrid].forEach(grid => {
                const empty = !grid.querySelector('.peak-card');
                grid.style.display = empty ? 'none' : '';
                const divider = grid.previousElementSibling;
                if (divider && divider.classList.contains('section-divider')) {
                    divider.style.display = empty ? 'none' : '';
                }
            });
        });
}
