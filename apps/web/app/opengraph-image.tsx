import { ImageResponse } from 'next/og';

export const alt = 'Titan Inc — progressão de raid gravada na régua';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        color: 'rgb(233, 241, 221)',
        background:
          'radial-gradient(ellipse at 72% 42%, rgb(18, 48, 31), rgb(11, 17, 22) 48%, rgb(14, 21, 26) 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          background:
            'linear-gradient(100deg, rgb(14, 21, 26) 0%, rgba(14, 21, 26, .76) 48%, transparent 82%)',
        }}
      />
      <div
        style={{
          width: 760,
          padding: '118px 0 70px 84px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          TITAN<span style={{ marginLeft: 3, color: 'rgb(143, 240, 75)' }}>INC</span>
        </div>
        <div style={{ marginTop: 92, fontSize: 30, lineHeight: 1.3, color: 'rgb(170, 178, 156)' }}>
          Endgame sem abrir mão da vida real.
        </div>
        <div
          style={{
            marginTop: 38,
            display: 'flex',
            alignItems: 'flex-end',
            color: 'rgb(170, 178, 156)',
          }}
        >
          <div
            style={{
              display: 'flex',
              paddingRight: 20,
              fontSize: 14,
              letterSpacing: '.14em',
            }}
          >
            PROGRESSÃO · SEM LEITURA
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              height: 19,
              borderBottom: '1px solid rgb(35, 39, 51)',
            }}
          >
            {Array.from({ length: 8 }, (_, indice) => (
              <div
                key={indice}
                style={{ width: 1, height: 7, display: 'flex', background: 'rgb(57, 66, 42)' }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 14,
              fontSize: 17,
              fontWeight: 700,
              color: 'rgb(233, 241, 221)',
            }}
          >
            —/—
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          bottom: 45,
          height: 1,
          background: 'rgba(233, 241, 221, .12)',
        }}
      />
    </div>,
    size,
  );
}
