// Back (Android's back button, a browser's Back, a swipe) closes an open
// pop-up instead of leaving the page. Call right after dialog.showModal():
// it adds a history entry for the pop-up; Back pops it and closes the dialog,
// and closing the dialog any other way (×, backdrop, Esc) drops the entry
// again so the next Back still leaves the page. Same URL, so no hashchange.
function closeDialogOnBack(dialog) {
    const id = `${Date.now()}-${Math.random()}`;
    history.pushState({ ...(history.state || {}), jgDialog: id }, '', location.href);
    let popped = false;
    const onPop = () => {
        popped = true;
        if (dialog.open) dialog.close();
    };
    window.addEventListener('popstate', onPop, { once: true });
    dialog.addEventListener('close', () => {
        window.removeEventListener('popstate', onPop);
        if (!popped && history.state && history.state.jgDialog === id) history.back();
    }, { once: true });
}
