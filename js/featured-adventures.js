// Featured Adventures Page JavaScript

class FeaturedAdventuresPage {
    constructor() {
        this.data = null;
        this.init();
    }

    async init() {
        try {
            // Load adventure data
            this.data = adventureData;

            // Render the page content
            this.renderFeaturedAdventures();
            this.renderAllAdventures();

            // Cards with a report are real links, so the browser handles
            // click, Enter and focus; the focus ring is in
            // css/featured-adventures.css.

        } catch (error) {
            console.error('Error initializing featured adventures page:', error);
            this.showError('Failed to load adventure data');
        }
    }

    renderFeaturedAdventures() {
        const container = document.getElementById('featured-adventures-container');
        if (!container || !this.data?.featured) return;

        container.innerHTML = '';

        this.data.featured.forEach(adventure => {
            const card = this.createFeaturedAdventureCard(adventure);
            container.appendChild(card);
        });
    }

    // True when the adventure has a real trip report page to open
    hasReport(adventure) {
        return Boolean(adventure.link && adventure.link !== '#');
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    // A card with a report is a real link (keyboard, middle-click and
    // "open in new tab" all work); one without is a plain, non-clickable card.
    createCardElement(adventure, className) {
        const hasReport = this.hasReport(adventure);
        const card = document.createElement(hasReport ? 'a' : 'div');
        card.className = className;
        card.setAttribute('data-adventure-id', adventure.id);

        if (hasReport) {
            card.href = adventure.link;
        } else {
            card.classList.add('no-report');
        }

        return card;
    }

    createFeaturedAdventureCard(adventure) {
        const esc = value => this.escapeHtml(value);
        const card = this.createCardElement(adventure, 'featured-card');

        card.innerHTML = `
            <img src="${esc(adventure.image)}" 
                 alt="${esc(adventure.title)}" 
                 class="featured-card-image"
                 loading="lazy" decoding="async" width="640" height="400"
                 onerror="this.onerror=null;this.src='images/placeholder-adventure.svg'">
            <div class="featured-card-content">
                <div class="featured-card-category">${esc(adventure.category)}</div>
                <h3 class="featured-card-title">${esc(adventure.title)}</h3>
                <p class="featured-card-subtitle">${esc(adventure.subtitle)}</p>
                <p class="featured-card-description">${esc(adventure.description)}</p>
                <div class="featured-card-date">${esc(adventure.date)}</div>
                ${this.hasReport(adventure) ? '' : '<div class="card-report-coming">Report coming</div>'}
            </div>
        `;

        return card;
    }

    renderAllAdventures() {
        const container = document.getElementById('all-adventures-container');
        if (!container || !this.data?.categories) return;

        container.innerHTML = '';

        // Render each category
        Object.entries(this.data.categories).forEach(([categoryName, adventures]) => {
            if (adventures.length > 0) {
                const categorySection = this.createCategorySection(categoryName, adventures);
                container.appendChild(categorySection);
            }
        });
    }

    createCategorySection(categoryName, adventures) {
        const section = document.createElement('div');
        section.className = 'category-section';
        section.setAttribute('data-category', categoryName);

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <h3 class="category-title">${this.formatCategoryName(categoryName)}</h3>
        `;

        const gridContainer = document.createElement('div');
        const grid = document.createElement('div');
        grid.className = 'category-grid';

        // On mobile, start with collapsed state if there are more than 3 adventures
        const isMobile = window.innerWidth <= 768;
        if (isMobile && adventures.length > 3) {
            grid.classList.add('collapsed');
        }

        adventures.forEach(adventure => {
            const card = this.createAdventureCard(adventure);
            grid.appendChild(card);
        });

        gridContainer.appendChild(grid);

        // Add expand/collapse button for mobile if there are more than 3 adventures
        if (isMobile && adventures.length > 3) {
            const expandBtn = document.createElement('button');
            expandBtn.className = 'category-expand-btn';
            expandBtn.textContent = `Show all ${adventures.length} adventures`;
            expandBtn.addEventListener('click', () => {
                this.toggleCategoryExpansion(grid, expandBtn, adventures.length);
            });
            gridContainer.appendChild(expandBtn);
        }

        section.appendChild(header);
        section.appendChild(gridContainer);

        return section;
    }

    createAdventureCard(adventure) {
        const esc = value => this.escapeHtml(value);
        const card = this.createCardElement(adventure, 'adventure-card');

        card.innerHTML = `
            <img src="${esc(adventure.image)}" 
                 alt="${esc(adventure.title)}" 
                 class="adventure-card-image"
                 loading="lazy" decoding="async" width="640" height="360"
                 onerror="this.onerror=null;this.src='images/placeholder-adventure.svg'">
            <div class="adventure-card-content">
                <h4 class="adventure-card-title">${esc(adventure.title)}</h4>
                <div class="adventure-card-category">${esc(adventure.category)}${adventure.date ? ' · ' + esc(adventure.date) : ''}</div>
                ${this.hasReport(adventure) ? '' : '<div class="card-report-coming">Report coming</div>'}
            </div>
        `;

        return card;
    }

    toggleCategoryExpansion(grid, button, totalCount) {
        const isCollapsed = grid.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand - show all cards
            grid.classList.remove('collapsed');
            button.textContent = 'Show less';
        } else {
            // Collapse - show only first 3 cards
            grid.classList.add('collapsed');
            button.textContent = `Show all ${totalCount} adventures`;
        }
    }

    formatCategoryName(categoryName) {
        // Convert camelCase to Title Case
        return categoryName
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    showError(message) {
        const containers = [
            document.getElementById('featured-adventures-container'),
            document.getElementById('all-adventures-container')
        ];

        containers.forEach(container => {
            if (container) {
                container.innerHTML = `
                    <div class="error-message" style="
                        text-align: center; 
                        color: #ff6b6b; 
                        padding: 2rem; 
                        font-size: 1.1rem;
                    ">
                        <p>${message}</p>
                        <button onclick="location.reload()" style="
                            background: #4CAF50; 
                            color: #0e1410; 
                            border: none; 
                            padding: 0.5rem 1rem; 
                            border-radius: 4px; 
                            cursor: pointer; 
                            margin-top: 1rem;
                        ">
                            Try Again
                        </button>
                    </div>
                `;
            }
        });
    }

    // Utility method to get adventure by ID
    getAdventureById(id) {
        // Check featured adventures first
        const featured = this.data?.featured?.find(adventure => adventure.id === id);
        if (featured) return featured;

        // Check all categories
        for (const [categoryName, adventures] of Object.entries(this.data?.categories || {})) {
            const found = adventures.find(adventure => adventure.id === id);
            if (found) return found;
        }

        return null;
    }

    // Method to filter adventures by category
    filterByCategory(categoryName) {
        const categorySection = document.querySelector(`[data-category="${categoryName}"]`);
        if (categorySection) {
            categorySection.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
    }

    // Method to search adventures
    searchAdventures(query) {
        const searchTerm = query.toLowerCase();
        const allCards = document.querySelectorAll('.featured-card, .adventure-card');

        allCards.forEach(card => {
            const title = card.querySelector('.featured-card-title, .adventure-card-title')?.textContent.toLowerCase() || '';
            const category = card.querySelector('.featured-card-category, .adventure-card-category')?.textContent.toLowerCase() || '';
            const description = card.querySelector('.featured-card-description')?.textContent.toLowerCase() || '';

            const matches = title.includes(searchTerm) ||
                category.includes(searchTerm) ||
                description.includes(searchTerm);

            card.style.display = matches ? '' : 'none';
        });

        // Hide empty category sections
        const categorySections = document.querySelectorAll('.category-section');
        categorySections.forEach(section => {
            const visibleCards = section.querySelectorAll('.adventure-card:not([style*="display: none"])');
            section.style.display = visibleCards.length > 0 ? '' : 'none';
        });
    }
}

// Initialize the page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new FeaturedAdventuresPage();
});

// Export for potential use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FeaturedAdventuresPage;
}