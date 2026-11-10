import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// LOW BID mark: a rounded teal tile with a falling price line that ends in a gavel-like
/// amber block, next to the wordmark.
class LowBidLogo extends StatelessWidget {
  const LowBidLogo({super.key, this.size = 40, this.showWordmark = true, this.onDark = false});

  final double size;
  final bool showWordmark;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final ink = onDark ? Colors.white : (Theme.of(context).brightness == Brightness.dark ? Colors.white : AppColors.teal);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox.square(dimension: size, child: CustomPaint(painter: _MarkPainter())),
        if (showWordmark) ...[
          SizedBox(width: size * 0.28),
          Text.rich(
            TextSpan(children: [
              TextSpan(text: 'LOW', style: TextStyle(fontWeight: FontWeight.w900, color: ink)),
              const TextSpan(text: ' '),
              const TextSpan(text: 'BID', style: TextStyle(fontWeight: FontWeight.w900, color: AppColors.amber)),
            ]),
            style: TextStyle(fontSize: size * 0.62, letterSpacing: size * 0.02, height: 1),
          ),
        ],
      ],
    );
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final r = RRect.fromRectAndRadius(Offset.zero & s, Radius.circular(s.width * 0.26));
    canvas.drawRRect(r, Paint()..color = AppColors.teal);

    // Falling price line.
    final line = Paint()
      ..color = Colors.white
      ..strokeWidth = s.width * 0.09
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(s.width * 0.20, s.height * 0.28)
      ..lineTo(s.width * 0.40, s.height * 0.50)
      ..lineTo(s.width * 0.54, s.height * 0.40)
      ..lineTo(s.width * 0.72, s.height * 0.66);
    canvas.drawPath(path, line);

    // Gavel head where the line lands.
    canvas.save();
    canvas.translate(s.width * 0.74, s.height * 0.70);
    canvas.rotate(-0.6);
    final head = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: s.width * 0.30, height: s.height * 0.16),
      Radius.circular(s.width * 0.04),
    );
    canvas.drawRRect(head, Paint()..color = AppColors.amber);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
