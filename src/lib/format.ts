export const formatBytes = (value: number): string => {
    if (value < 1024) {
        return `${value} B`;
    }
    const units = ["KB", "MB", "GB"];
    let size = value / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatTime = (timestamp: number): string =>
    new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(timestamp);
