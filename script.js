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
