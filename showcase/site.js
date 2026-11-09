const header = document.querySelector('[data-header]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const items = document.querySelectorAll('.reveal');
if (reduceMotion || !('IntersectionObserver' in window)) {
  items.forEach((item) => item.classList.add('visible'));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
  );
  items.forEach((item) => observer.observe(item));
}
