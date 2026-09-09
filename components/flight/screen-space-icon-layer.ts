import { IconLayer } from "@deck.gl/layers";

/** Pixel-sized billboards whose projected size is independent of camera depth.
 * IconLayer normally projects pixel offsets at the camera's focal distance.
 * Use each anchor's actual clip-space depth to cancel the perspective divide.
 */
export class ScreenSpaceIconLayer<T> extends IconLayer<T> {
  static override layerName = "ScreenSpaceIconLayer";

  override getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        ...shaders.inject,
        "vs:DECKGL_FILTER_SIZE": `
          if (icon.billboard) {
            size.xy *= gl_Position.w / project.focalDistance;
          }
        `,
      },
    };
  }
}
