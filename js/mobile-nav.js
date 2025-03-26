document.addEventListener('DOMContentLoaded', function () {
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;

    if (isMobile) {
        const dropdowns = document.querySelectorAll('.dropdown');

        function closeAllDropdowns() {
            dropdowns.forEach(d => {
                d.classList.remove('active');
                const content = d.querySelector('.dropdown-content');
                if (content) content.style.display = 'none';
            });
        }

        document.addEventListener('touchstart', function (e) {
            if (!e.target.closest('.dropdown')) {
                closeAllDropdowns();
            }
        });

        dropdowns.forEach(dropdown => {
            const button = dropdown.querySelector('.dropbtn');
            const content = dropdown.querySelector('.dropdown-content');

            button.addEventListener('touchstart', function (e) {
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
                    link.addEventListener('touchstart', function (e) {
                        e.stopPropagation();
                        setTimeout(() => {
                            window.location.href = this.href;
                        }, 100);
                    });
                });
            }
        });
    }

    // Add hover effect to dropdowns
    const dropdownLinks = document.querySelectorAll('.dropdown-content a');
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
});
