export const isMarketOpen = (): boolean => {
  const now = new Date();
  
  // Use Indian Standard Time (IST)
  const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  
  const day = istTime.getDay();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Market hours: 9:00 AM - 4:00 PM
  const startMinutes = 9 * 60;      // 9:00 AM
  const endMinutes = 16 * 60;       // 4:00 PM

  // Check if it's a weekday (Monday=1 to Friday=5)
  if (day >= 1 && day <= 5) {
    if (totalMinutes >= startMinutes && totalMinutes < endMinutes) {
      // Within trading hours on a weekday - check if it's a holiday
      // Note: We check holidays asynchronously, so this is a best-effort check
      // The actual holiday check happens in the background
      return true; // Assume open, holiday check will update UI asynchronously
    }
  }

  return false;
};
