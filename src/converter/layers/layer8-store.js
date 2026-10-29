/**
 * @module layer8-store
 * Layer 8: Storage of the resulting JSON in R2.
 *
 * Responsibilities:
 * 1. Serialize the complete ConversionResult to indented JSON (2 spaces).
 * 2. Obtain the R2 binding from env using variables.BINDING_R2.
 * 3. Build the output key from variables.R2_OUTPUT_PATH_TEMPLATE.
 * 4. Upload the JSON to R2 with Content-Type application/json.
 * 5. Handle upload errors with a descriptive message.
 * 6. Return the key of the stored object.
 *
 * The R2 binding name and the output path template are injected through the
 * configuration objects; this module hardcodes neither the output prefix nor
 * the file extension, and fails explicitly when either value is missing.
 *
 * @see ./layer7-assemble.js - Produces the ConversionResult consumed here
 * @see ../../shared/config.js - loadConfig() and loadVariables()
 * @see ../../shared/version.js - CONVERTER_VERSION
 */

/**
 * Layer 8: Uploads the ConversionResult to R2.
 *
 * Serializes the complete conversion result to JSON and stores it in the
 * configured R2 bucket. The key is built by applying the template defined in
 * variables.R2_OUTPUT_PATH_TEMPLATE, where `{uuid}` is replaced by the UUID
 * received as a parameter.
 *
 * @param {ConversionResult} result - Object with the 10 normalized collections
 * @param {string} uuid - Conversion UUID
 * @param {Object} env - Worker environment bindings
 * @param {Object} config - Environment configuration
 * @param {string} config.R2_BUCKET_NAME - R2 bucket name
 * @param {Object} variables - Behavior variables
 * @param {string} variables.BINDING_R2 - Name of the R2 binding in env
 * @param {string} variables.R2_OUTPUT_PATH_TEMPLATE - Output key template
 * @returns {Promise<string>} Key of the object stored in R2 (for example
 *          "<prefix>/<uuid>.json" as defined by the injected template)
 * @throws {Error} When the R2 binding name or the output path template is
 *         missing, when the R2 binding is not available in env, or when the
 *         upload to R2 fails
 *
 * @example
 * import { storeResult } from './layer8-store.js';
 *
 * const key = await storeResult(result, uuid, env, config, variables);
 * // key = the template applied to the conversion UUID
 */
import { CONVERTER_VERSION } from '../../shared/version.js';

export async function storeResult(result, uuid, env, config, variables) {
  // ---------------------------------------------------------------------------
  // 1. Serialize the ConversionResult to readable JSON
  // ---------------------------------------------------------------------------
  const jsonString = JSON.stringify(result, null, 2);

  // ---------------------------------------------------------------------------
  // 2. Obtain the R2 binding from env
  // ---------------------------------------------------------------------------
  const bindingName = variables.BINDING_R2;
  if (typeof bindingName !== 'string' || bindingName.length === 0) {
    throw new Error(
      '[Capa 8] Binding R2 no configurado: falta variables.BINDING_R2.'
    );
  }

  const bucket = env[bindingName];

  if (!bucket) {
    throw new Error(
      `[Capa 8] Binding R2 no disponible: "${bindingName}". ` +
      `Verifica que el binding esté configurado en wrangler.toml.`
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Build the output key by replacing {uuid} with the received UUID
  // ---------------------------------------------------------------------------
  const outputPathTemplate = variables.R2_OUTPUT_PATH_TEMPLATE;
  if (typeof outputPathTemplate !== 'string' || outputPathTemplate.length === 0) {
    throw new Error(
      '[Capa 8] Plantilla de ruta de salida no configurada: ' +
      'falta variables.R2_OUTPUT_PATH_TEMPLATE.'
    );
  }

  const key = outputPathTemplate.replace(
    /\{uuid\}/g,
    uuid
  );

  // ---------------------------------------------------------------------------
  // 4. Upload the JSON to R2 with HTTP metadata
  // ---------------------------------------------------------------------------
  try {
    await bucket.put(key, jsonString, {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: { version: CONVERTER_VERSION },
    });
  } catch (err) {
    throw new Error(
      `[Capa 8] Error al subir el resultado a R2 (bucket="${config.R2_BUCKET_NAME}", ` +
      `key="${key}"): ${err.message}`
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Return the key of the stored object
  // ---------------------------------------------------------------------------
  return key;
}
