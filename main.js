document.addEventListener('DOMContentLoaded', function() {
    // Navigation Toggle
    const navBtn = document.getElementById('nav-btn');
    const takeoverNav = document.getElementById('takeover-nav');
    let isNavOpen = false;

    navBtn.addEventListener('click', function() {
        isNavOpen = !isNavOpen;
        if (isNavOpen) {
            takeoverNav.classList.add('shown');
        } else {
            takeoverNav.classList.remove('shown');
        }
    });

    // Smooth Scroll for Navigation Links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                if (isNavOpen) {
                    takeoverNav.classList.remove('shown');
                    isNavOpen = false;
                }
            }
        });
    });

    // Custom Cursor
    const cursor = document.querySelector('.custom-cursor');
    if (cursor) {
        document.addEventListener('mousemove', (e) => {
            cursor.style.opacity = 1;
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        });

        document.addEventListener('mouseleave', () => {
            cursor.style.opacity = 0;
        });

        document.addEventListener('mouseenter', () => {
            cursor.style.opacity = 1;
        });

        // Add hover effect for links
        document.querySelectorAll('a, button').forEach(el => {
            el.addEventListener('mouseenter', () => {
                cursor.classList.add('custom-cursor--link');
            });
            el.addEventListener('mouseleave', () => {
                cursor.classList.remove('custom-cursor--link');
            });
        });
    }

    // Intersection Observer for Scroll Animations
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
            }
        });
    }, observerOptions);

    document.querySelectorAll('.section-title, .section-text').forEach(el => {
        observer.observe(el);
    });
});