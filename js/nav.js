document.addEventListener('DOMContentLoaded', function () {
    // Add active class to current page
    const currentLocation = location.href;
    const menuItems = document.querySelectorAll('.nav-menu a');

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

    // Mobile menu handling (if needed)
    const dropdowns = document.querySelectorAll('.dropdown');

    dropdowns.forEach(dropdown => {
        dropdown.addEventListener('touchstart', function (e) {
            e.preventDefault();
            this.querySelector('.dropdown-content').style.display =
                this.querySelector('.dropdown-content').style.display === 'block' ? 'none' : 'block';
        });
    });
});