(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var nav = document.getElementById("siteNav");
  var root = document.documentElement;

  function updateNav() {
    if (!nav) return;
    if (window.scrollY > 12) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  }

  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });

  var revealEls = document.querySelectorAll(".reveal");
  revealEls.forEach(function (el) {
    var order = el.getAttribute("data-stagger");
    if (order) el.style.setProperty("--stagger", order);
  });

  if (!reduce && "IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16 });

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("in");
    });
  }

  var parallaxEls = document.querySelectorAll("[data-parallax]");

  function updateParallax() {
    if (reduce || !parallaxEls.length) return;
    var scrollY = window.scrollY;
    parallaxEls.forEach(function (el) {
      var speed = parseFloat(el.getAttribute("data-speed") || "0.12");
      var y = scrollY * speed;
      el.style.transform = "translate3d(0," + y.toFixed(2) + "px,0)";
    });
  }

  updateParallax();
  window.addEventListener("scroll", updateParallax, { passive: true });

  var magneticEls = document.querySelectorAll(".magnetic");
  if (!reduce) {
    magneticEls.forEach(function (el) {
      el.addEventListener("mousemove", function (event) {
        if (window.innerWidth < 861) return;
        var rect = el.getBoundingClientRect();
        var strength = parseFloat(el.getAttribute("data-magnetic-strength") || "0.16");
        var x = (event.clientX - rect.left) / rect.width - 0.5;
        var y = (event.clientY - rect.top) / rect.height - 0.5;
        el.style.transform = "translate3d(" + (x * rect.width * strength).toFixed(2) + "px," + (y * rect.height * strength).toFixed(2) + "px,0)";
      });

      el.addEventListener("mouseleave", function () {
        el.style.transform = "";
      });
    });
  }

  var cursorDot = document.getElementById("cursorDot");
  var cursorRing = document.getElementById("cursorRing");
  if (!reduce && cursorDot && cursorRing && window.innerWidth > 860) {
    var pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var ring = { x: pointer.x, y: pointer.y };
    var rafId = null;

    function renderCursor() {
      ring.x += (pointer.x - ring.x) * 0.16;
      ring.y += (pointer.y - ring.y) * 0.16;

      cursorDot.style.transform = "translate3d(" + pointer.x + "px," + pointer.y + "px,0)";
      cursorRing.style.transform = "translate3d(" + ring.x + "px," + ring.y + "px,0)";

      rafId = window.requestAnimationFrame(renderCursor);
    }

    function showCursor() {
      cursorDot.style.opacity = "1";
      cursorRing.style.opacity = "1";
      if (!rafId) rafId = window.requestAnimationFrame(renderCursor);
    }

    function hideCursor() {
      cursorDot.style.opacity = "0";
      cursorRing.style.opacity = "0";
    }

    window.addEventListener("mousemove", function (event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      root.style.setProperty("--pointer-x", event.clientX + "px");
      root.style.setProperty("--pointer-y", event.clientY + "px");
      showCursor();
    });

    window.addEventListener("mouseout", function (event) {
      if (!event.relatedTarget) hideCursor();
    });

    document.querySelectorAll("a, button, .magnetic").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        cursorRing.classList.add("active");
      });
      el.addEventListener("mouseleave", function () {
        cursorRing.classList.remove("active");
      });
    });
  }

  var counters = document.querySelectorAll("[data-count]");
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffix = el.textContent.indexOf("+") > -1 ? "+" : "";
    var duration = 1100;
    var startTime = null;

    function tick(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.floor(progress * target) + suffix;
      if (progress < 1) window.requestAnimationFrame(tick);
      else el.textContent = target + suffix;
    }

    window.requestAnimationFrame(tick);
  }

  if (counters.length) {
    if (!reduce && "IntersectionObserver" in window) {
      var counterObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.6 });

      counters.forEach(function (el) {
        counterObserver.observe(el);
      });
    } else {
      counters.forEach(function (el) {
        el.textContent = el.getAttribute("data-count") + (el.textContent.indexOf("+") > -1 ? "+" : "");
      });
    }
  }

  var timeline = document.getElementById("timeline");
  if (timeline && !reduce) {
    var items = timeline.querySelectorAll(".timeline-item");

    function updateTimeline() {
      var rect = timeline.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var start = vh * 0.78;
      var end = vh * 0.3;
      var total = rect.height - (start - end);
      var passed = start - rect.top;
      var progress = Math.min(1, Math.max(0, passed / total));
      timeline.style.setProperty("--progress", progress.toFixed(4));

      items.forEach(function (item) {
        var itemRect = item.getBoundingClientRect();
        if (itemRect.top < vh * 0.58 && itemRect.bottom > vh * 0.28) item.classList.add("active");
        else item.classList.remove("active");
      });
    }

    updateTimeline();
    window.addEventListener("scroll", updateTimeline, { passive: true });
    window.addEventListener("resize", updateTimeline);
  } else if (timeline) {
    timeline.style.setProperty("--progress", "1");
  }
})();
