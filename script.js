function generateRandom() {
    // Generate random number
    const randomNum = Math.floor(Math.random() * 100) + 1;
    const randomNumberElement = document.getElementById('randomNumber');
    if (randomNumberElement) {
        randomNumberElement.textContent = 'Random Number: ' + randomNum;
    }

    // Fetch random image from Unsplash
    fetch('https://api.unsplash.com/photos/random?orientation=landscape&query=nature', {
        headers: {
            'Authorization': 'Client-ID xJtD_jKrs_cL4Bn64vDMihQnK3MvcFmYvqpVNEeAJ7I'
        }
    })
        .then(response => response.json())
        .then(data => {
            document.body.style.backgroundImage = `url(${data.urls.regular})`;
        })
        .catch(error => console.error('Error:', error));
}

// Generate a random number and background when the page loads
if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
    generateRandom();
}


// Parallax effect for About page
function checkScroll() {
    const sections = document.querySelectorAll('.info');
    sections.forEach(section => {
        const sectionTop = section.getBoundingClientRect().top;
        const sectionBottom = section.getBoundingClientRect().bottom;
        if (sectionTop < window.innerHeight && sectionBottom > 0) {
            section.classList.add('active');
        } else {
            section.classList.remove('active');
        }
    });
}

if (document.querySelector('.about-page')) {
    window.addEventListener('scroll', checkScroll);
    checkScroll(); // Check on page load
}