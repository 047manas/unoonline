function getCardIcon(value) {
    switch (value) {
        case 'skip': return '⊘';
        case 'reverse': return '↻';
        case 'draw2': return '+2';
        case 'wild': return 'W';
        case 'wildDraw4': return '+4';
        default: return value;
    }
}

function createCardHTML(card, index, isPlayable = false, isDrop = false) {
    const icon = getCardIcon(card.value);
    const playableClass = isPlayable ? 'playable' : '';
    const animClass = isDrop ? 'card-drop' : 'card-enter';

    // For deck/discard, black cards show actual color if currentColor is set
    // But in hand, they should be black. This logic is handled in the app.js by modifying color.
    let displayColor = card.color;
    if (card.type === 'wild' && card.isDiscardTop) {
        displayColor = card.declaredColor;
    }

    const bgClass = `bg-${displayColor}`;

    // Fan effect for hand
    let style = '';
    if (!isDrop && index !== undefined && !card.isDiscardTop) {
        // Simple rotation based on index could be added here, handled by CSS mostly though
    } else if (card.isDiscardTop) {
        // Random slight rotation for discarded cards to look natural
        const rot = (Math.random() * 20 - 10).toFixed(1);
        style = `style="transform: rotate(${rot}deg);"`;
    }

    return `
        <div class="uno-card ${bgClass} ${playableClass} ${animClass}" data-index="${index !== undefined ? index : ''}" ${style}>
            <div class="corner-val top-left">${icon}</div>
            <div class="ellipse">
                <span class="center-val">${icon}</span>
            </div>
            <div class="corner-val bottom-right">${icon}</div>
        </div>
    `;
}
