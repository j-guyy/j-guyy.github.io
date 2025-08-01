class NavbarComponent extends HTMLElement {
    constructor() {
        super();
        // Get the base path from attribute, default to empty string
        const basePath = this.getAttribute('base-path') || '';

        // Organized navigation structure with logical groupings
        this.innerHTML = `
            <nav class="navbar">
                <div class="navbar-container">
                    <div class="navbar-brand">
                        <a href="${basePath}index.html">JG</a>
                    </div>
                    <button class="hamburger" aria-label="Toggle navigation menu" aria-expanded="false">
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                    </button>
                    <ul class="nav-menu">
                        <li><a href="${basePath}index.html">Home</a></li>
                        <li class="dropdown">
                            <a href="#" class="dropbtn">US Travel <span class="mobile-plus-icon">+</span></a>
                            <div class="dropdown-content">
                                <a href="${basePath}us-dashboard.html">Dashboard</a>
                                <a href="${basePath}us-map.html">Map</a>
                            </div>
                        </li>
                        <li class="dropdown">
                            <a href="#" class="dropbtn">World Travel <span class="mobile-plus-icon">+</span></a>
                            <div class="dropdown-content">
                                <a href="${basePath}world-dashboard.html">Dashboard</a>
                                <a href="${basePath}world-map.html">Map</a>
                            </div>
                        </li>
                        <li class="dropdown">
                            <a href="#" class="dropbtn">Adventures <span class="mobile-plus-icon">+</span></a>
                            <div class="dropdown-content">
                                <a href="${basePath}adventures.html">List</a>
                                <a href="${basePath}objectives-list.html">Glider</a>
                                <a href="${basePath}side-quests.html">Side Quests</a>
                            </div>
                        </li>
                        <li><a href="${basePath}about.html">About</a></li>
                    </ul>
                </div>
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

        // Mobile menu handling - removed duplicate touch handling
        // This is now handled in setupMobileTouchHandlers for better mobile support

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

        // Initialize hamburger menu
        this.initializeHamburgerMenu();
    }

    initializeMobileNavigation() {
        const dropdowns = this.querySelectorAll('.dropdown');

        // Always setup universal handlers for maximum compatibility
        this.setupUniversalDropdownHandlers(dropdowns);

        // Setup keyboard navigation for accessibility
        this.setupKeyboardNavigation(dropdowns);

        // Add hover effects for non-touch devices
        this.setupHoverEffects();

        // Handle window resize to reinitialize mobile features
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    setupUniversalDropdownHandlers(dropdowns) {
        const isMobile = () => window.innerWidth <= 768;

        const closeAllDropdowns = () => {
            dropdowns.forEach(d => {
                d.classList.remove('active');
                d.setAttribute('aria-expanded', 'false');
                const content = d.querySelector('.dropdown-content');
                const plusIcon = d.querySelector('.mobile-plus-icon');
                if (content) {
                    // Don't manipulate display on mobile - CSS handles it with max-height
                    if (!isMobile()) {
                        content.style.display = 'none';
                    }
                    content.setAttribute('aria-hidden', 'true');
                }
                if (plusIcon) {
                    plusIcon.textContent = '+';
                }
            });
        };

        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Close dropdowns when touching/clicking outside (only on desktop)
        if (isTouchDevice) {
            document.addEventListener('touchstart', (e) => {
                if (!isMobile() && !e.target.closest('.dropdown')) {
                    closeAllDropdowns();
                }
            }, { passive: true });
        } else {
            document.addEventListener('click', (e) => {
                if (!isMobile() && !e.target.closest('.dropdown')) {
                    closeAllDropdowns();
                }
            });
        }

        dropdowns.forEach(dropdown => {
            const button = dropdown.querySelector('.dropbtn');
            const content = dropdown.querySelector('.dropdown-content');
            const plusIcon = dropdown.querySelector('.mobile-plus-icon');

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

            // Function to toggle dropdown state
            const toggleDropdownState = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const isCurrentlyOpen = dropdown.classList.contains('active');

                // On mobile, use accordion behavior (only close others if opening this one)
                if (isMobile()) {
                    if (!isCurrentlyOpen) {
                        // Close all other dropdowns when opening a new one
                        dropdowns.forEach(d => {
                            if (d !== dropdown) {
                                d.classList.remove('active');
                                d.setAttribute('aria-expanded', 'false');
                                const otherContent = d.querySelector('.dropdown-content');
                                const otherPlusIcon = d.querySelector('.mobile-plus-icon');
                                if (otherContent) {
                                    // Don't manipulate display on mobile - CSS handles it
                                    otherContent.setAttribute('aria-hidden', 'true');
                                }
                                if (otherPlusIcon) {
                                    otherPlusIcon.textContent = '+';
                                }
                            }
                        });
                    }
                } else {
                    // Desktop behavior - close all others
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
                }

                // Toggle current dropdown
                if (isCurrentlyOpen) {
                    dropdown.classList.remove('active');
                    button.setAttribute('aria-expanded', 'false');
                    if (content) {
                        // Only manipulate display on desktop
                        if (!isMobile()) {
                            content.style.display = 'none';
                        }
                        content.setAttribute('aria-hidden', 'true');
                    }
                    if (plusIcon) {
                        plusIcon.textContent = '+';
                    }
                } else {
                    dropdown.classList.add('active');
                    button.setAttribute('aria-expanded', 'true');
                    if (content) {
                        // Only manipulate display on desktop
                        if (!isMobile()) {
                            content.style.display = 'block';
                        }
                        content.setAttribute('aria-hidden', 'false');

                        // Focus first menu item for keyboard users
                        const firstLink = content.querySelector('a');
                        if (firstLink && document.activeElement === button) {
                            firstLink.focus();
                        }
                    }
                    if (plusIcon) {
                        plusIcon.textContent = '−';
                    }
                }
            };

            // Use touch events for touch devices, click for others
            if (isTouchDevice) {
                button.addEventListener('touchstart', toggleDropdownState, { passive: false });
            } else {
                button.addEventListener('click', toggleDropdownState);
            }

            // Enhanced handling for dropdown links
            if (content) {
                const links = content.querySelectorAll('a');
                links.forEach(link => {
                    // Improve touch target size
                    link.style.minHeight = '44px';
                    link.style.display = 'flex';
                    link.style.alignItems = 'center';
                    link.style.justifyContent = 'flex-start';

                    if (isTouchDevice) {
                        // Touch-only handling for mobile
                        link.addEventListener('touchstart', (e) => {
                            e.stopPropagation();
                            link.style.backgroundColor = 'rgba(0, 128, 0, 0.3)';
                        }, { passive: true });

                        link.addEventListener('touchend', (e) => {
                            e.stopPropagation();
                            setTimeout(() => {
                                link.style.backgroundColor = '';
                                // Don't close dropdowns on mobile - let them stay open for accordion behavior
                                if (!isMobile()) {
                                    closeAllDropdowns();
                                }
                                // Navigate after visual feedback
                                if (link.href && link.href !== '#') {
                                    window.location.href = link.href;
                                }
                            }, 150);
                        }, { passive: true });

                        link.addEventListener('touchcancel', () => {
                            link.style.backgroundColor = '';
                        }, { passive: true });
                    } else {
                        // Click handling for desktop
                        link.addEventListener('click', (e) => {
                            e.stopPropagation();
                            closeAllDropdowns();
                        });
                    }
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
        const plusIcon = dropdown.querySelector('.mobile-plus-icon');
        const isMobile = window.innerWidth <= 768;

        dropdown.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
        if (content) {
            // Only manipulate display on desktop - mobile uses CSS max-height
            if (!isMobile) {
                content.style.display = 'block';
            }
            content.setAttribute('aria-hidden', 'false');
        }
        if (plusIcon) {
            plusIcon.textContent = '−';
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
        const plusIcon = dropdown.querySelector('.mobile-plus-icon');
        const isMobile = window.innerWidth <= 768;

        dropdown.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
        if (content) {
            // Only manipulate display on desktop - mobile uses CSS max-height
            if (!isMobile) {
                content.style.display = 'none';
            }
            content.setAttribute('aria-hidden', 'true');
        }
        if (plusIcon) {
            plusIcon.textContent = '+';
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

    initializeHamburgerMenu() {
        const hamburger = this.querySelector('.hamburger');
        const navMenu = this.querySelector('.nav-menu');

        if (hamburger && navMenu) {
            hamburger.addEventListener('click', () => {
                const isExpanded = hamburger.getAttribute('aria-expanded') === 'true';

                // Toggle menu visibility
                navMenu.classList.toggle('nav-menu-active');
                hamburger.classList.toggle('hamburger-active');

                // Update ARIA attribute
                hamburger.setAttribute('aria-expanded', !isExpanded);

                // Close any open dropdowns when hamburger menu closes
                if (isExpanded) {
                    const dropdowns = this.querySelectorAll('.dropdown');
                    dropdowns.forEach(dropdown => {
                        this.closeDropdown(dropdown);
                        const plusIcon = dropdown.querySelector('.mobile-plus-icon');
                        if (plusIcon) {
                            plusIcon.textContent = '+';
                        }
                    });
                }
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!this.contains(e.target)) {
                    navMenu.classList.remove('nav-menu-active');
                    hamburger.classList.remove('hamburger-active');
                    hamburger.setAttribute('aria-expanded', 'false');

                    // Close all dropdowns when menu closes
                    const dropdowns = this.querySelectorAll('.dropdown');
                    dropdowns.forEach(dropdown => {
                        this.closeDropdown(dropdown);
                        const plusIcon = dropdown.querySelector('.mobile-plus-icon');
                        if (plusIcon) {
                            plusIcon.textContent = '+';
                        }
                    });
                }
            });

            // Close menu when clicking on a nav link (but not dropdown buttons)
            const navLinks = this.querySelectorAll('.nav-menu a:not(.dropbtn)');
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    navMenu.classList.remove('nav-menu-active');
                    hamburger.classList.remove('hamburger-active');
                    hamburger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    }

    handleResize() {
        const isMobile = window.innerWidth <= 768;
        const dropdowns = this.querySelectorAll('.dropdown');
        const navMenu = this.querySelector('.nav-menu');
        const hamburger = this.querySelector('.hamburger');

        // Close all dropdowns on resize to prevent layout issues
        dropdowns.forEach(dropdown => {
            this.closeDropdown(dropdown);
        });

        // Close hamburger menu on resize
        if (navMenu && hamburger) {
            navMenu.classList.remove('nav-menu-active');
            hamburger.classList.remove('hamburger-active');
            hamburger.setAttribute('aria-expanded', 'false');
        }

        // No need to reinitialize - universal handlers work on all devices
    }
}

// Define the custom element
customElements.define('nav-bar', NavbarComponent);
