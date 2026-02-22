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

            // Set up event listeners
            this.setupEventListeners();

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

    createFeaturedAdventureCard(adventure) {
        const card = document.createElement('div');
        card.className = 'featured-card';
        card.setAttribute('data-adventure-id', adventure.id);

        card.innerHTML = `
            <img src="${adventure.image}" 
                 alt="${adventure.title}" 
                 class="featured-card-image"
                 onerror="this.src='images/placeholder-adventure.svg'">
            <div class="featured-card-content">
                <div class="featured-card-category">${adventure.category}</div>
                <h3 class="featured-card-title">${adventure.title}</h3>
                <p class="featured-card-subtitle">${adventure.subtitle}</p>
                <p class="featured-card-description">${adventure.description}</p>
                <div class="featured-card-date">${adventure.date}</div>
            </div>
        `;

        // Add click handler
        card.addEventListener('click', () => {
            this.navigateToAdventure(adventure);
        });

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
        const card = document.createElement('div');
        card.className = 'adventure-card';
        card.setAttribute('data-adventure-id', adventure.id);

        card.innerHTML = `
            <img src="${adventure.image}" 
                 alt="${adventure.title}" 
                 class="adventure-card-image"
                 onerror="this.src='images/placeholder-adventure.svg'">
            <div class="adventure-card-content">
                <h4 class="adventure-card-title">${adventure.title}</h4>
                <div class="adventure-card-category">${adventure.category}${adventure.date ? ' · ' + adventure.date : ''}</div>
            </div>
        `;

        // Add click handler
        card.addEventListener('click', () => {
            this.navigateToAdventure(adventure);
        });

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

    navigateToAdventure(adventure) {
        if (adventure.link && adventure.link !== '#') {
            window.location.href = adventure.link;
        } else {
            // Show a message for adventures without detailed pages
            this.showAdventurePreview(adventure);
        }
    }

    showAdventurePreview(adventure) {
        // Simple alert for now - could be enhanced with a modal
        alert(`${adventure.title}\n\nThis adventure doesn't have a detailed page yet, but stay tuned for more content!`);
    }

    setupEventListeners() {
        // Add keyboard navigation support
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const focusedCard = document.activeElement;
                if (focusedCard && (focusedCard.classList.contains('featured-card') ||
                    focusedCard.classList.contains('adventure-card'))) {
                    e.preventDefault();
                    focusedCard.click();
                }
            }
        });

        // Make cards focusable for accessibility
        const allCards = document.querySelectorAll('.featured-card, .adventure-card');
        allCards.forEach(card => {
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');

            // Add focus styles
            card.addEventListener('focus', () => {
                card.style.outline = '2px solid #4CAF50';
                card.style.outlineOffset = '2px';
            });

            card.addEventListener('blur', () => {
                card.style.outline = '';
                card.style.outlineOffset = '';
            });
        });
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
                            color: white; 
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
            categorySection.scrollIntoView({ behavior: 'smooth' });
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