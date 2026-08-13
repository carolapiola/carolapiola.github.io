# Carola Piola

TTS en tiempo real creado por **Carola Piola**.

Web: [carolapiola.github.io](https://carolapiola.github.io/)

Una app de escritorio mínima para hablar mientras escribes. Usa Kokoro 82M, la voz española `ef_dora` y WebGPU. El tamaño de cada grupo y el cooldown toman sus valores iniciales de `src/speech-settings.js` y se pueden ajustar desde la barra inferior. Enter envía el texto pendiente inmediatamente. El cooldown solo envía palabras terminadas con espacio o puntuación, por lo que nunca corta una palabra que todavía se está escribiendo. Cada clip espera al anterior: nunca interrumpe el audio que ya está sonando.

## Ejecutar

Necesitas Node.js 20.19+.

```bash
npm install
npm run dev
```

Para abrir una compilación local:

```bash
npm start
```

Para crear el instalador de tu plataforma:

```bash
npm run package
```

Cada push a `main` compila y publica automáticamente la versión web mediante GitHub Pages.

## Motor de voz

- Modelo: `onnx-community/Kokoro-82M-v1.0-ONNX`
- Voz: Dora (`ef_dora`), español
- Ruta principal: WebGPU + FP32 (~326 MB)
- Respaldo automático: WASM + Q4 (~305 MB) si WebGPU no está disponible
- Frecuencia de audio: 24 kHz

La primera ejecución descarga el modelo, el tokenizador y la voz. Los recursos quedan en la caché de Chromium para los siguientes arranques. La fonemización española se hace localmente con `ephone`/eSpeak-NG y la síntesis también ocurre dentro de la app; una vez que los recursos estén en caché, no hace falta una conexión.

`ephone` y eSpeak-NG se distribuyen bajo GPL-3.0-or-later. El empaquetado incluye una copia de su licencia en `resources/licenses/ephone-GPL-3.0.txt`. Kokoro y sus pesos ONNX usan Apache-2.0.

## Licencia

El código original de este proyecto fue creado por Carola Piola y se ofrece bajo [CC0 1.0 Universal](LICENSE). Las dependencias, Kokoro, sus pesos y los recursos de terceros conservan sus respectivas licencias.

El textarea conserva todo el historial visible y mantiene el foco dentro de la ventana. El texto ya enviado se registra mediante un cursor interno: nunca se borra del cuadro ni se vuelve a enviar al cumplirse la pausa. Enter habla inmediatamente y Tab no cambia el foco.

Los clips generados se recortan únicamente en sus bordes silenciosos y se programan sobre una misma línea temporal de Web Audio. Si el siguiente clip está listo antes de que termine el actual, ambos se reproducen consecutivamente sin una pausa introducida por JavaScript.
