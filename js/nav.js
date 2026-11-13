// Navigation glue: starts the screen router and wires the "Start workout" buttons.
export function initNav({ onStartTraining }) {
    document.addEventListener('click', e => {
        if (e.target.closest('[data-action="start-training"]')) onStartTraining();
    });
}
