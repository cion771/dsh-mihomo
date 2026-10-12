export function matchesSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return false;

  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return false;
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  } else if (typeof value !== schema.type) {
    return false;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }

  return true;
}
