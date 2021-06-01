resource "aws_instance" "main" {
  ami                    = var.ami.amazon-linux-2
  instance_type          = "t2.micro"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.public_instance.id]
  user_data              = file("./user_data.tpl")
  key_name               = var.key-pair
  placement_group        = ""

  tags = {
    Name    = "${var.project}-ec2-instance"
    project = var.project
  }
}

resource "aws_alb_target_group_attachment" "main" {
  target_group_arn = aws_lb_target_group.main.arn
  target_id        = aws_instance.main.id
  port             = 80
}

resource "aws_security_group" "public_instance" {
  description = "This is a security group for API server for sushi-chat app. It allows http and https from alb, and ssh from admin."
  vpc_id = aws_vpc.main.id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = [var.cidr_default_gateway.ipv4] #tfsec:ignore:AWS009
    ipv6_cidr_blocks = [var.cidr_default_gateway.ipv6] #tfsec:ignore:AWS009
  }

  tags = {
    Name    = "${var.project}-sg-public-instance"
    project = var.project
  }
}

resource "aws_security_group_rule" "allow_ssh" {
  description = "This allow ssh to public instance from admin."
  security_group_id = aws_security_group.public_instance.id
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = [var.my_global_ip]
}

resource "aws_security_group_rule" "allow_http" {
  description = "This allows http from alb."
  security_group_id        = aws_security_group.public_instance.id
  type                     = "ingress"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.public_alb.id
}

resource "aws_security_group_rule" "allow_https" {
  description = "This allows https from alb."
  security_group_id        = aws_security_group.public_instance.id
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.public_alb.id
}