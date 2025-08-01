class FeaturedContentSection extends HTMLElement {
    constructor() {
        super();
        this.featuredItems = [
            {
                id: 'pico-summit',
                type: 'trip-report',
                title: 'Pico de Orizaba Summit',
                description: 'Conquering Mexico\'s highest peak at 18,491ft',
                image: 'images/mountaineering/pico/summit_cropped.jpg',
                link: 'trip-reports/pico-de-orizaba.html',
                priority: 1,
                tags: ['mountaineering', 'mexico', 'summit']
            },
            {
                id: 'creede-100',
                type: 'achievement',
                title: '100-Mile Ultramarathon',
                description: 'Completing the Creede 100 in Colorado',
                image: 'images/ultrarunning/creede/finish_cropped.jpg',
                link: 'trip-reports/creede-100.html',
                priority: 2,
                tags: ['ultrarunning', 'colorado', 'endurance']
            },
            {
                id: 'travel-progress',
                type: 'dashboard',
                title: 'Travel Progress',
                description: 'Explore interactive maps and statistics',
                image: 'images/img20.jpg',
                link: 'us-dashboard.html',
                priority: 3,
                tags: ['travel', 'statistics', 'maps']
            }
        ];
    }

    connectedCallback() {
        this.showLoadingState();
        // Simulate async loading and add error handling
        this.loadContent()
            .then(() => {
                this.render();
                this.addEventListeners();
            })
            .catch((error) => {
                console.error('Failed to load featured content:', error);
                this.showErrorState();
            });
    }

    showLoadingState() {
        this.innerHTML = `
            <section class="featured-content-section">
                <div class="featured-content-container">
                    <h2 class="featured-title">Featured Adventures</h2>
                    <div class="featured-grid loading">
                        <div class="loading-card">
                            <div class="loading-skeleton loading-image"></div>
                            <div class="loading-skeleton loading-title"></div>
                            <div class="loading-skeleton loading-description"></div>
                        </div>
                        <div class="loading-card">
                            <div class="loading-skeleton loading-image"></div>
                            <div class="loading-skeleton loading-title"></div>
                            <div class="loading-skeleton loading-description"></div>
                        </div>
                        <div class="loading-card">
                            <div class="loading-skeleton loading-image"></div>
                            <div class="loading-skeleton loading-title"></div>
                            <div class="loading-skeleton loading-description"></div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    showErrorState() {
        this.innerHTML = `
            <section class="featured-content-section">
                <div class="featured-content-container">
                    <h2 class="featured-title">Featured Adventures</h2>
                    <div class="error-state">
                        <div class="error-icon">⚠️</div>
                        <p class="error-message">Unable to load featured content. Please try refreshing the page.</p>
                        <button class="retry-button" onclick="this.closest('featured-content-section').connectedCallback()">
                            Retry
                        </button>
                    </div>
                    <noscript>
                        <div class="fallback-content">
                            <div class="fallback-card">
                                <h3><a href="trip-reports/pico-de-orizaba.html">Pico de Orizaba Summit</a></h3>
                                <p>Conquering Mexico's highest peak at 18,491ft</p>
                            </div>
                            <div class="fallback-card">
                                <h3><a href="trip-reports/creede-100.html">100-Mile Ultramarathon</a></h3>
                                <p>Completing the Creede 100 in Colorado</p>
                            </div>
                            <div class="fallback-card">
                                <h3><a href="us-dashboard.html">Travel Progress</a></h3>
                                <p>Explore interactive maps and statistics</p>
                            </div>
                        </div>
                    </noscript>
                </div>
            </section>
        `;
    }

    async loadContent() {
        // Simulate loading delay and potential failure
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                // Simulate random failure for testing (remove in production)
                if (Math.random() < 0.1) {
                    reject(new Error('Network error'));
                } else {
                    resolve();
                }
            }, 500);
        });
    }

    render() {
        this.innerHTML = `
            <section class="featured-content-section">
                <div class="featured-content-container">
                    <h2 class="featured-title">Featured Adventures</h2>
                    <div class="featured-grid">
                        ${this.featuredItems.map(item => this.createCard(item)).join('')}
                    </div>
                </div>
            </section>
        `;
    }

    createCard(item) {
        return `
            <div class="featured-card" data-link="${item.link}" data-type="${item.type}" tabindex="0" role="button" aria-label="Navigate to ${item.title}">
                <div class="card-image-container">
                    <img src="${item.image}" alt="${item.title}" class="card-image" loading="lazy">
                    <div class="card-overlay"></div>
                </div>
                <div class="card-content">
                    <h3 class="card-title">${item.title}</h3>
                    <p class="card-description">${item.description}</p>
                    <div class="card-tags">
                        ${item.tags.map(tag => `<span class="card-tag">${tag}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    addEventListeners() {
        const cards = this.querySelectorAll('.featured-card');
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                const link = card.getAttribute('data-link');
                if (link) {
                    window.location.href = link;
                }
            });

            // Add keyboard support
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const link = card.getAttribute('data-link');
                    if (link) {
                        window.location.href = link;
                    }
                }
            });
        });
    }
}

// Register the custom element
customElements.define('featured-content-section', FeaturedContentSection);