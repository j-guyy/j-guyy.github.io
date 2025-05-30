class NavbarComponent extends HTMLElement {
    constructor() {
        super();
        // Get the base path from attribute, default to empty string
        const basePath = this.getAttribute('base-path') || '';

        this.innerHTML = `
            <nav class="navbar">
                <ul class="nav-menu">
                    <li><a href="${basePath}index.html">Home</a></li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">US Travel</a>
                        <div class="dropdown-content">
                            <a href="${basePath}us-dashboard.html">Dashboard</a>
                            <a href="${basePath}us-map.html">Interactive Map</a>
                            <a href="${basePath}us-quests.html">Side Quests</a>
                        </div>
                    </li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">World Travel</a>
                        <div class="dropdown-content">
                            <a href="${basePath}world-dashboard.html">Dashboard</a>
                            <a href="${basePath}world-map.html">Interactive Map</a>
                        </div>
                    </li>
                    <li class="dropdown">
                        <a href="#" class="dropbtn">Objectives</a>
                        <div class="dropdown-content">
                            <a href="${basePath}objectives-list.html">Objectives List</a>
                            <a href="${basePath}3dmap.html">3D Model Viewer</a>
                        </div>
                    </li>
                    <li><a href="${basePath}about.html">About Me</a></li>
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

        if (isMobile) {
            const dropdowns = this.querySelectorAll('.dropdown');

            const closeAllDropdowns = () => {
                dropdowns.forEach(d => {
                    d.classList.remove('active');
                    const content = d.querySelector('.dropdown-content');
                    if (content) content.style.display = 'none';
                });
            };

            document.addEventListener('touchstart', (e) => {
                if (!e.target.closest('.dropdown')) {
                    closeAllDropdowns();
                }
            });

            dropdowns.forEach(dropdown => {
                const button = dropdown.querySelector('.dropbtn');
                const content = dropdown.querySelector('.dropdown-content');

                button.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Close other dropdowns
                    dropdowns.forEach(d => {
                        if (d !== dropdown) {
                            d.classList.remove('active');
                            const otherContent = d.querySelector('.dropdown-content');
                            if (otherContent) otherContent.style.display = 'none';
                        }
                    });

                    // Toggle current dropdown
                    dropdown.classList.toggle('active');
                    if (content) {
                        content.style.display = content.style.display === 'block' ? 'none' : 'block';
                    }
                });

                // Ensure links are clickable
                if (content) {
                    const links = content.querySelectorAll('a');
                    links.forEach(link => {
                        link.addEventListener('touchstart', (e) => {
                            e.stopPropagation();
                            setTimeout(() => {
                                window.location.href = link.href;
                            }, 100);
                        });
                    });
                }
            });
        }

        // Add hover effect to dropdowns (for both mobile and desktop)
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
    }
}

// Define the custom element
customElements.define('nav-bar', NavbarComponent);
