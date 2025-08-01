class NavbarComponent extends HTMLElement {
    constructor() {
        super();
        // Get the base path from attribute, default to empty string
        const basePath = this.getAttribute('base-path') || '';

        // Organized navigation structure with logical groupings
        this.innerHTML = `
            <nav class="navbar">
                <ul class="nav-menu">
                    <li><a href="${basePath}index.html">Home</a></li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">US Travel</a>
                        <div class="dropdown-content">
                            <a href="${basePath}us-dashboard.html">Dashboard</a>
                            <a href="${basePath}us-map.html">Map</a>
                        </div>
                    </li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">World Travel</a>
                        <div class="dropdown-content">
                            <a href="${basePath}world-dashboard.html">Dashboard</a>
                            <a href="${basePath}world-map.html">Map</a>
                        </div>
                    </li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">Adventures</a>
                        <div class="dropdown-content">
                            <a href="${basePath}adventures.html">List</a>
                            <a href="${basePath}objectives-list.html">Glider</a>
                            <a href="${basePath}side-quests.html">Side Quests</a>
                        </div>
                    </li>
                    <li><a href="${basePath}about.html">About</a></li>
                </ul>
            </nav>
        `;
    }

    connectedCallback() {
        // Initialize navigation functionality when component is added to DOM
        this.initializeNavigation();
    }

    initializeNavigation() {
        // Add active class to current page
        const currentLocation = location.href;
        const menuItems = this.querySelectorAll('.nav-menu a');

        menuItems.forEach(link => {
            if (link.href === currentLocation) {
                link.classList.add('active');

                // If active link is in dropdown, add active state to parent
                const parentDropdown = link.closest('.dropdown');
                if (parentDropdown) {
                    parentDropdown.querySelector('.dropbtn').classList.add('active');
                }
            }
        });

        // Mobile menu handling
        const dropdowns = this.querySelectorAll('.dropdown');

        dropdowns.forEach(dropdown => {
            dropdown.addEventListener('touchstart', function (e) {
                e.preventDefault();
                this.querySelector('.dropdown-content').style.display =
                    this.querySelector('.dropdown-content').style.display === 'block' ? 'none' : 'block';
            });
        });

        // Add hover effect to dropdowns
        const dropdownLinks = this.querySelectorAll('.dropdown-content a');
        dropdownLinks.forEach(link => {
            link.addEventListener('mouseover', function () {
                this.style.backgroundColor = 'rgba(0, 128, 0, 0.5)'; // semi-transparent green
                this.style.color = '#fff'; // white text
            });
            link.addEventListener('mouseout', function () {
                this.style.backgroundColor = ''; // reset background color
                this.style.color = ''; // reset text color
            });
        });

        // Mobile-specific functionality
        this.initializeMobileNavigation();
    }

    initializeMobileNavigation() {
        const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
        const dropdowns = this.querySelectorAll('.dropdown');

        // Enhanced mobile navigation with improved touch handling
        if (isMobile) {
            this.setupMobileTouchHandlers(dropdowns);
        }

        // Setup keyboard navigation for accessibility
        this.setupKeyboardNavigation(dropdowns);

        // Add hover effects for non-touch devices
        this.setupHoverEffects();

        // Handle window resize to reinitialize mobile features
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    setupMobileTouchHandlers(dropdowns) {
        const closeAllDropdowns = () => {
            dropdowns.forEach(d => {
                d.classList.remove('active');
                d.setAttribute('aria-expanded', 'false');
                const content = d.querySelector('.dropdown-content');
                if (content) {
                    content.style.display = 'none';
                    content.setAttribute('aria-hidden', 'true');
                }
            });
        };

        // Close dropdowns when touching outside
        document.addEventListener('touchstart', (e) => {
            if (!e.target.closest('.dropdown')) {
                closeAllDropdowns();
            }
        }, { passive: true });

        dropdowns.forEach(dropdown => {
            const button = dropdown.querySelector('.dropbtn');
            const content = dropdown.querySelector('.dropdown-content');

            // Set initial ARIA attributes
            button.setAttribute('aria-haspopup', 'true');
            button.setAttribute('aria-expanded', 'false');
            if (content) {
                content.setAttribute('role', 'menu');
                content.setAttribute('aria-hidden', 'true');

                // Set ARIA attributes for menu items
                const links = content.querySelectorAll('a');
                links.forEach(link => {
                    link.setAttribute('role', 'menuitem');
                    link.setAttribute('tabindex', '-1');
                });
            }

            // Enhanced touch handling for dropdown buttons
            button.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const isCurrentlyOpen = dropdown.classList.contains('active');

                // Close all other dropdowns
                dropdowns.forEach(d => {
                    if (d !== dropdown) {
                        d.classList.remove('active');
                        d.setAttribute('aria-expanded', 'false');
                        const otherContent = d.querySelector('.dropdown-content');
                        if (otherContent) {
                            otherContent.style.display = 'none';
                            otherContent.setAttribute('aria-hidden', 'true');
                        }
                    }
                });

                // Toggle current dropdown
                if (isCurrentlyOpen) {
                    dropdown.classList.remove('active');
                    button.setAttribute('aria-expanded', 'false');
                    if (content) {
                        content.style.display = 'none';
                        content.setAttribute('aria-hidden', 'true');
                    }
                } else {
                    dropdown.classList.add('active');
                    button.setAttribute('aria-expanded', 'true');
                    if (content) {
                        content.style.display = 'block';
                        content.setAttribute('aria-hidden', 'false');

                        // Focus first menu item for keyboard users
                        const firstLink = content.querySelector('a');
                        if (firstLink && document.activeElement === button) {
                            firstLink.focus();
                        }
                    }
                }
            }, { passive: false });

            // Enhanced touch handling for dropdown links
            if (content) {
                const links = content.querySelectorAll('a');
                links.forEach(link => {
                    // Improve touch target size and add visual feedback
                    link.style.minHeight = '44px';
                    link.style.display = 'flex';
                    link.style.alignItems = 'center';
                    link.style.justifyContent = 'center';

                    link.addEventListener('touchstart', (e) => {
                        e.stopPropagation();

                        // Add visual feedback
                        link.style.backgroundColor = 'rgba(0, 128, 0, 0.3)';

                        // Navigate after a short delay to show feedback
                        setTimeout(() => {
                            if (link.href && link.href !== '#') {
                                window.location.href = link.href;
                            }
                        }, 150);
                    }, { passive: true });

                    link.addEventListener('touchend', (e) => {
                        // Remove visual feedback
                        setTimeout(() => {
                            link.style.backgroundColor = '';
                        }, 200);
                    }, { passive: true });

                    link.addEventListener('touchcancel', (e) => {
                        // Remove visual feedback on cancel
                        link.style.backgroundColor = '';
                    }, { passive: true });
                });
            }
        });
    }

    setupKeyboardNavigation(dropdowns) {
        dropdowns.forEach(dropdown => {
            const button = dropdown.querySelector('.dropbtn');
            const content = dropdown.querySelector('.dropdown-content');

            button.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        this.toggleDropdown(dropdown);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.openDropdownAndFocusFirst(dropdown);
                        break;
                    case 'Escape':
                        this.closeDropdown(dropdown);
                        break;
                }
            });

            if (content) {
                const links = content.querySelectorAll('a');
                links.forEach((link, index) => {
                    link.addEventListener('keydown', (e) => {
                        switch (e.key) {
                            case 'ArrowDown':
                                e.preventDefault();
                                const nextLink = links[index + 1] || links[0];
                                nextLink.focus();
                                break;
                            case 'ArrowUp':
                                e.preventDefault();
                                const prevLink = links[index - 1] || links[links.length - 1];
                                prevLink.focus();
                                break;
                            case 'Escape':
                                e.preventDefault();
                                this.closeDropdown(dropdown);
                                button.focus();
                                break;
                            case 'Tab':
                                if (e.shiftKey && index === 0) {
                                    this.closeDropdown(dropdown);
                                } else if (!e.shiftKey && index === links.length - 1) {
                                    this.closeDropdown(dropdown);
                                }
                                break;
                        }
                    });
                });
            }
        });
    }

    toggleDropdown(dropdown) {
        const isOpen = dropdown.classList.contains('active');
        if (isOpen) {
            this.closeDropdown(dropdown);
        } else {
            this.openDropdown(dropdown);
        }
    }

    openDropdown(dropdown) {
        const button = dropdown.querySelector('.dropbtn');
        const content = dropdown.querySelector('.dropdown-content');

        dropdown.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
        if (content) {
            content.style.display = 'block';
            content.setAttribute('aria-hidden', 'false');
        }
    }

    openDropdownAndFocusFirst(dropdown) {
        this.openDropdown(dropdown);
        const content = dropdown.querySelector('.dropdown-content');
        if (content) {
            const firstLink = content.querySelector('a');
            if (firstLink) {
                firstLink.focus();
            }
        }
    }

    closeDropdown(dropdown) {
        const button = dropdown.querySelector('.dropbtn');
        const content = dropdown.querySelector('.dropdown-content');

        dropdown.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
        if (content) {
            content.style.display = 'none';
            content.setAttribute('aria-hidden', 'true');
        }
    }

    setupHoverEffects() {
        // Only add hover effects for non-touch devices
        if (!('ontouchstart' in window)) {
            const dropdownLinks = this.querySelectorAll('.dropdown-content a');
            dropdownLinks.forEach(link => {
                link.addEventListener('mouseover', function () {
                    this.style.backgroundColor = 'rgba(0, 128, 0, 0.5)';
                    this.style.color = '#fff';
                });
                link.addEventListener('mouseout', function () {
                    this.style.backgroundColor = '';
                    this.style.color = '';
                });
            });
        }
    }

    handleResize() {
        const isMobile = window.innerWidth <= 768;
        const dropdowns = this.querySelectorAll('.dropdown');

        // Close all dropdowns on resize to prevent layout issues
        dropdowns.forEach(dropdown => {
            this.closeDropdown(dropdown);
        });

        // Reinitialize mobile features if needed
        if (isMobile && !this.mobileInitialized) {
            this.setupMobileTouchHandlers(dropdowns);
            this.mobileInitialized = true;
        } else if (!isMobile && this.mobileInitialized) {
            this.mobileInitialized = false;
        }
    }
}

// Define the custom element
customElements.define('nav-bar', NavbarComponent);
