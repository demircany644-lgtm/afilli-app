export function storeMoney(valueKurus: number) {
  return `₺${(valueKurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
